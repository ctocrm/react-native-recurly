#!/usr/bin/env node
/**
 * Text POC: Tuta login + list Inbox. Prints every REST hop.
 * Secrets stay in gitignored .env. Never print passwords.
 */
import {
  argon2Sync,
  createDecipheriv,
  createHash,
  createHmac,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

const ROOT = resolve(import.meta.dirname, "../..");
const BASE = "https://app.tuta.com";
const MODEL_V = "154";
const TUTANOTA_V = "102";
const MAIL_V = "105";
const MAIL_DV = "144";
const STORAGE_V = "14";
const CLIENT_V = "357.260818.1";

const MIN_ID = "------------";
const MAX_ID = "zzzzzzzzzzzz";
const FIXED_IV = Buffer.alloc(16, 0x88);

function loadEnv() {
  const text = readFileSync(resolve(ROOT, ".env"), "utf8");
  const out = {};
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function log(step, extra) {
  console.log(`\n===== ${step} =====`);
  if (extra !== undefined)
    console.log(
      typeof extra === "string" ? extra : JSON.stringify(extra, null, 2),
    );
}

function keysOf(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return [`[array ${value.length}]`];
  if (typeof value === "object") return Object.keys(value);
  return [typeof value];
}

function firstId(raw) {
  if (raw == null) return "";
  if (Array.isArray(raw))
    return raw.length === 0 ? "" : firstId(raw[raw.length - 1]);
  return String(raw).trim().replace(/^"|"$/g, "");
}

function firstObject(raw) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw[0] &&
    typeof raw[0] === "object"
  )
    return raw[0];
  return null;
}

function idPair(raw) {
  if (Array.isArray(raw)) {
    // Tuta IdTuple is often wrapped: [[listId, elementId]]
    if (raw.length === 1 && Array.isArray(raw[0])) return idPair(raw[0]);
    if (raw.length >= 2) return [String(raw[0]), String(raw[1])];
    if (raw.length === 1) return [String(raw[0]), ""];
    return ["", ""];
  }
  if (raw && typeof raw === "object") {
    return [
      firstId(raw["0"] ?? raw.listId),
      firstId(raw["1"] ?? raw.elementId),
    ];
  }
  if (typeof raw === "string" && raw.includes("/")) {
    const [a, b] = raw.split("/");
    return [a, b ?? ""];
  }
  return ["", ""];
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest();
}
function sha512(buf) {
  return createHash("sha512").update(buf).digest();
}

function decodeBase64Ext(raw) {
  const ext =
    "-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz";
  const std =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let mapped = "";
  for (const ch of raw) {
    const idx = ext.indexOf(ch);
    if (idx < 0) throw new Error("not base64ext");
    mapped += std[idx];
  }
  if (mapped.length % 4 === 2) mapped += "==";
  else if (mapped.length % 4 === 3) mapped += "=";
  else if (mapped.length % 4 === 1) throw new Error("bad base64ext length");
  return Buffer.from(mapped, "base64");
}

function decodeTutaBytes(s) {
  const trimmed = String(s ?? "").trim();
  if (!trimmed) return [];
  const seen = new Map();
  const add = (label, buf) => {
    if (!buf || buf.length === 0) return;
    const key = buf.toString("hex");
    if (!seen.has(key)) seen.set(key, { label, buf });
  };
  try {
    add("std", Buffer.from(trimmed, "base64"));
  } catch {}
  try {
    const url = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const pad = url + "=".repeat((4 - (url.length % 4)) % 4);
    add("url", Buffer.from(pad, "base64"));
  } catch {}
  try {
    add("ext", decodeBase64Ext(trimmed));
  } catch {}
  return [...seen.values()];
}

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function aesDecrypt(key, ciphertext, padded, hasPrependedIv = true) {
  const authenticated = ciphertext.length % 2 === 1;
  let body;
  let encKey;
  if (authenticated) {
    if (ciphertext[0] !== 1)
      throw new Error(`unknown cipher version ${ciphertext[0]}`);
    const hashed = key.length === 16 ? sha256(key) : sha512(key);
    encKey = hashed.subarray(0, key.length);
    const authKey = hashed.subarray(key.length);
    const withoutVersion = ciphertext.subarray(1, ciphertext.length - 32);
    const mac = ciphertext.subarray(ciphertext.length - 32);
    const expected = hmacSha256(authKey, withoutVersion);
    if (!expected.equals(mac)) throw new Error("HMAC mismatch");
    body = withoutVersion;
  } else {
    encKey = key;
    body = ciphertext;
  }
  const iv = hasPrependedIv ? body.subarray(0, 16) : FIXED_IV;
  const blocks = hasPrependedIv ? body.subarray(16) : body;
  const decipher = createDecipheriv(`aes-${encKey.length * 8}-cbc`, encKey, iv);
  decipher.setAutoPadding(padded);
  return Buffer.concat([decipher.update(blocks), decipher.final()]);
}

function decryptKey(wrappingKey, encoded) {
  const keys = [wrappingKey];
  if (wrappingKey.length > 16) keys.push(wrappingKey.subarray(0, 16));
  let last = null;
  for (const { label, buf } of decodeTutaBytes(encoded)) {
    for (const key of keys) {
      try {
        const hasIv = key.length !== 16 || buf.length % 2 === 1;
        const out = aesDecrypt(key, buf, false, hasIv);
        return { key: out, encoding: label, keyLen: key.length };
      } catch (e) {
        last = e;
      }
    }
  }
  throw last ?? new Error("key unwrap failed");
}

function decryptBytes(cipherB64, sessionKey) {
  if (!cipherB64 || !sessionKey) return null;
  for (const { buf } of decodeTutaBytes(cipherB64)) {
    try {
      return aesDecrypt(sessionKey, buf, true);
    } catch {
      // try next encoding
    }
  }
  return null;
}

function decryptString(cipherB64, sessionKey) {
  const bytes = decryptBytes(cipherB64, sessionKey);
  return bytes ? bytes.toString("utf8") : "";
}

function tutaDecompress(bytes) {
  if (!bytes || bytes.length === 0) return "";
  const src = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  let out = Buffer.alloc(Math.max(64, src.length * 6));
  let n = 0;
  let s = 0;
  const ensure = (need) => {
    if (out.length >= need) return;
    const next = Buffer.alloc(Math.max(out.length * 2, need));
    out.copy(next);
    out = next;
  };
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit > 0) {
      let extra = lit + 240;
      while (extra === 255) {
        extra = src[s++];
        lit += extra;
      }
      ensure(n + lit);
      src.copy(out, n, s, s + lit);
      n += lit;
      s += lit;
      if (s === src.length) break;
    }
    if (s + 1 >= src.length) break;
    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    if (offset === 0 || offset > n) {
      throw new Error(`tuta decompress bad offset ${offset} at ${s}`);
    }
    let match = token & 15;
    let extra = match + 240;
    while (extra === 255) {
      extra = src[s++];
      match += extra;
    }
    const end = n + match + 4;
    ensure(end);
    let from = n - offset;
    while (n < end) out[n++] = out[from++];
  }
  return out.subarray(0, n).toString("utf8");
}

function inflateMaybe(bytes) {
  if (!bytes || bytes.length === 0) return "";
  try {
    const tuta = tutaDecompress(bytes);
    if (tuta && tuta.includes("<") && !tuta.includes("\u0000")) return tuta;
    if (tuta && tuta.length > 20) return tuta;
  } catch {
    // not tuta-compressed
  }
  for (const fn of [gunzipSync, inflateSync, inflateRawSync]) {
    try {
      return fn(bytes).toString("utf8");
    } catch {
      // try next
    }
  }
  try {
    return bytes.toString("utf8");
  } catch {
    return "";
  }
}


function firstNode(value) {
  if (Array.isArray(value)) return value.length ? firstNode(value[0]) : null;
  return value ?? null;
}

function walkLongestPlain(node, sessionKey) {
  let best = "";
  const visit = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object") {
      for (const item of Object.values(value)) visit(item);
      return;
    }
    if (typeof value !== "string" || value.length < 16) return;
    const bytes = decryptBytes(value, sessionKey);
    if (!bytes) return;
    const inflated = inflateMaybe(bytes);
    const plain =
      inflated && inflated.length >= bytes.length
        ? inflated
        : bytes.toString("utf8");
    if (plain && !plain.startsWith("[decrypt fail") && plain.length > best.length) {
      best = plain;
    }
  };
  visit(node);
  return best;
}

function bodyFromDetails(details, sessionKey) {
  const root = firstNode(details);
  const body = firstNode(root?.["1288"] ?? root?.body);
  const compressed = body?.["1276"] ?? body?.compressedText;
  const text = body?.["1275"] ?? body?.text;
  if (compressed) {
    const bytes = decryptBytes(compressed, sessionKey);
    if (bytes) {
      const inflated = inflateMaybe(bytes);
      if (inflated) return inflated;
      return bytes.toString("utf8");
    }
  }
  if (text) {
    const raw = decryptString(text, sessionKey);
    if (raw) return raw;
  }
  return walkLongestPlain(root ?? details, sessionKey);
}

function derivePassphraseKey(password, salt, kdfVersion) {


  if (kdfVersion === "0") {
    throw new Error(
      "bcrypt kdf not implemented in this POC; account used Argon2 last time",
    );
  }
  if (kdfVersion !== "1") throw new Error(`unknown kdfVersion ${kdfVersion}`);
  return argon2Sync("argon2id", {
    message: Buffer.from(password, "utf8"),
    nonce: salt,
    parallelism: 1,
    tagLength: 32,
    memory: 32 * 1024,
    passes: 4,
  });
}

function authVerifier(passphraseKey) {
  return sha256(passphraseKey).toString("base64url");
}

function randomCustomId() {
  return crypto.getRandomValues(Buffer.alloc(4)).toString("base64url");
}

async function request(
  method,
  url,
  { body, token, version, dependsOn, blobToken, clientPlatform } = {},
) {
  const headers = {
    Accept: "application/json",
    v: version ?? MODEL_V,
    cv: CLIENT_V,
    cp: clientPlatform ?? "5",
  };
  if (dependsOn) headers.dv = dependsOn;
  if (token) headers.accessToken = token;
  if (blobToken) headers.blobAccessToken = blobToken;
  if (body && method !== "GET") headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    headers,
    body: body && method !== "GET" ? body : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text.slice(0, 400) };
  }
  return {
    status: res.status,
    json,
    textLen: text.length,
    errorId: res.headers.get("error-id"),
  };
}

function firstAgg(value) {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function loadMailDetailsBlob({
  token,
  archiveId,
  instanceId,
  sessionKey,
}) {
  // Live Tuta web 201:
  // {"78":"0","80":[],"180":null,"181":[{"176":id,"177":archiveId,"178":null,"179":[]}]}
  // then GET `${blobServer}/rest/tutanota/maildetailsblob/${archiveId}?ids=...`
  const tokenBody = JSON.stringify({
    78: "0",
    80: [],
    180: null,
    181: [
      {
        176: randomCustomId(),
        177: archiveId,
        178: null,
        179: [],
      },
    ],
  });
  const tokenRes = await request(
    "POST",
    `${BASE}/rest/storage/blobaccesstokenservice`,
    { body: tokenBody, token, version: STORAGE_V, clientPlatform: "5" },
  );
  const info = firstAgg(tokenRes.json?.["161"] ?? tokenRes.json?.blobAccessInfo);
  const blobAccessToken = info?.["159"] ?? info?.blobAccessToken ?? "";
  const servers = (info?.["160"] ?? info?.servers ?? [])
    .flatMap((s) => (Array.isArray(s) ? s : [s]))
    .map((s) => s?.["156"] ?? s?.url ?? "")
    .filter(Boolean);
  log("blobAccessToken", {
    status: tokenRes.status,
    errorId: tokenRes.errorId,
    keys: keysOf(tokenRes.json),
    tokenChars: String(blobAccessToken).length,
    servers,
  });
  if (tokenRes.status < 200 || tokenRes.status > 299 || !blobAccessToken) {
    return { status: tokenRes.status, text: "" };
  }

  const targets = servers.length ? servers : [BASE];
  let last = { status: 0, json: null, errorId: null };
  for (const server of targets) {
    const origin = server.replace(/\/$/, "");
    const qs = new URLSearchParams({
      ids: instanceId,
      blobAccessToken,
      accessToken: token,
      v: "113",
      cv: CLIENT_V,
    });
    const url = `${origin}/rest/tutanota/maildetailsblob/${archiveId}?${qs}`;
    last = await request("GET", url, {
      version: "113",
      token,
      blobToken: blobAccessToken,
      clientPlatform: "5",
    });
    log("maildetailsblob GET", {
      origin,
      status: last.status,
      errorId: last.errorId,
      keys: keysOf(last.json),
      first: Array.isArray(last.json) ? keysOf(last.json[0]) : keysOf(last.json),
      rawHead: JSON.stringify(last.json)?.slice(0, 200),
    });
    if (last.status >= 200 && last.status <= 299 && last.json) break;
  }

  const instances = asArray(last.json);
  let best = "";
  for (const inst of instances) {
    const details = firstAgg(inst?.["1305"] ?? inst?.details ?? inst);
    const plain = bodyFromDetails(details, sessionKey);
    if (plain.length > best.length) best = plain;
    if (!plain) {
      const walked = walkLongestPlain(inst, sessionKey);
      if (walked.length > best.length) best = walked;
    }
  }
  return { status: last.status, text: best };
}





function asArray(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") return [json];
  return [];
}

async function main() {
  const env = loadEnv();
  const user = (env.TUTA_USER || "").trim().toLowerCase();
  const pass = env.TUTA_PASS || "";
  if (!user || !pass) {
    console.error("Missing TUTA_USER / TUTA_PASS in .env");
    process.exit(1);
  }
  log("start", { user, passLen: pass.length });

  const saltBody = JSON.stringify({ 418: "0", 419: user });
  const saltUrl = `${BASE}/rest/sys/saltservice?_body=${encodeURIComponent(saltBody)}`;
  const saltRes = await request("GET", saltUrl);
  log("SaltService", {
    status: saltRes.status,
    keys: keysOf(saltRes.json),
    kdf: saltRes.json?.["2133"] ?? saltRes.json?.kdfVersion,
    saltChars: String(saltRes.json?.["422"] ?? saltRes.json?.salt ?? "").length,
  });
  if (saltRes.status < 200 || saltRes.status > 299) {
    console.error("Salt failed", saltRes.status, keysOf(saltRes.json));
    process.exit(1);
  }
  const kdfVersion = String(
    saltRes.json["2133"] ?? saltRes.json.kdfVersion ?? "1",
  );
  const saltEnc = saltRes.json["422"] ?? saltRes.json.salt;
  const salt = decodeTutaBytes(saltEnc)[0]?.buf;
  if (!salt) throw new Error("no salt bytes");
  const passphraseKey = derivePassphraseKey(pass, salt, kdfVersion);
  log("KDF", {
    kdfVersion,
    saltLen: salt.length,
    keyLen: passphraseKey.length,
  });

  const sessionBody = JSON.stringify({
    1212: "0",
    1213: user,
    1214: authVerifier(passphraseKey),
    1215: "Linux Firefox",
    1216: null,
    1217: null,
    1417: null,
    1218: [],
  });
  const sessionRes = await request("POST", `${BASE}/rest/sys/sessionservice`, {
    body: sessionBody,
    version: MODEL_V,
  });
  log("SessionService", {
    status: sessionRes.status,
    keys: keysOf(sessionRes.json),
    userId: firstId(sessionRes.json?.["1223"] ?? sessionRes.json?.user),
    tokenChars: String(
      sessionRes.json?.["1221"] ?? sessionRes.json?.accessToken ?? "",
    ).length,
  });
  if (sessionRes.status < 200 || sessionRes.status > 299) {
    console.error("Session failed", sessionRes.status, keysOf(sessionRes.json));
    process.exit(1);
  }
  const token = sessionRes.json["1221"] || sessionRes.json.accessToken;
  const userId = firstId(sessionRes.json["1223"] ?? sessionRes.json.user);

  const userRes = await request("GET", `${BASE}/rest/sys/user/${userId}`, {
    token,
    version: MODEL_V,
  });
  log("User", { status: userRes.status, keys: keysOf(userRes.json) });
  const userGroup = firstObject(userRes.json?.["95"]);
  if (!userGroup) throw new Error("missing userGroup 95");
  log("userGroup", {
    keys: keysOf(userGroup),
    groupId: firstId(userGroup["29"]),
    ver: userGroup["2246"],
    enc27len: String(userGroup["27"] ?? "").length,
  });
  const ug = decryptKey(passphraseKey, userGroup["27"]);
  log("userGroupKey unwrap", {
    encoding: ug.encoding,
    wrappingKeyLen: ug.keyLen,
    outLen: ug.key.length,
  });

  const memberships = userRes.json["96"] ?? [];
  log(
    "memberships",
    memberships.map((m, i) => ({
      i,
      keys: keysOf(m),
      type1030: m["1030"],
      group: firstId(m["29"]),
      ver: m["2246"],
      enc27len: String(m["27"] ?? "").length,
    })),
  );
  const mailMem = memberships.find((m) => String(m["1030"]) === "5");
  if (!mailMem) throw new Error("no mail group type 5");
  const mailGroupId = firstId(mailMem["29"]);
  const mg = decryptKey(ug.key, mailMem["27"]);
  log("mailGroupKey unwrap", {
    mailGroupId,
    encoding: mg.encoding,
    wrappingKeyLen: mg.keyLen,
    outLen: mg.key.length,
  });

  const rootRes = await request(
    "GET",
    `${BASE}/rest/tutanota/mailboxgrouproot/${mailGroupId}`,
    {
      token,
      version: TUTANOTA_V,
    },
  );
  log("MailboxGroupRoot", {
    status: rootRes.status,
    keys: keysOf(rootRes.json),
    mailbox699: firstId(rootRes.json?.["699"]),
  });
  const mailboxId = firstId(rootRes.json?.["699"]);
  if (!mailboxId) throw new Error("no mailbox id 699");

  const boxRes = await request(
    "GET",
    `${BASE}/rest/tutanota/mailbox/${mailboxId}`,
    {
      token,
      version: TUTANOTA_V,
    },
  );
  log("MailBox", {
    status: boxRes.status,
    keys: keysOf(boxRes.json),
    attr443: boxRes.json?.["443"],
  });
  const mailSets = firstObject(boxRes.json?.["443"]);
  log("mailSets 443 object", mailSets);
  const mailSetListId = firstId(mailSets?.["442"]);
  log("mailSetListId 442", mailSetListId);
  if (!mailSetListId) throw new Error("no mailSets list id 442");

  const foldersRes = await request(
    "GET",
    `${BASE}/rest/tutanota/mailset/${mailSetListId}?start=${MIN_ID}&count=1000&reverse=false`,
    { token, version: TUTANOTA_V },
  );
  const folders = asArray(foldersRes.json);
  log("MailSet list", {
    status: foldersRes.status,
    count: folders.length,
    folders: folders.map((f, i) => ({
      i,
      keys: keysOf(f),
      type436: f["436"],
      entries1459: firstId(f["1459"]),
      nameEncLen: String(f["437"] ?? f["105"] ?? "").length,
    })),
  });

  let totalListed = 0;
  for (const folder of folders) {
    const type = String(folder["436"] ?? "");
    const entriesListId = firstId(folder["1459"]);
    if (!entriesListId) {
      log(`folder type=${type} has no 1459`);
      continue;
    }
    const entriesRes = await request(
      "GET",
      `${BASE}/rest/tutanota/mailsetentry/${entriesListId}?start=${MAX_ID}&count=20&reverse=true`,
      { token, version: TUTANOTA_V },
    );
    const entries = asArray(entriesRes.json);
    log(`mailsetentry type=${type} list=${entriesListId}`, {
      status: entriesRes.status,
      count: entries.length,
      firstKeys: keysOf(entries[0]),
      firstRaw: entries[0] ?? null,
    });
    if (entries.length === 0) continue;

    for (const entry of entries.slice(0, 5)) {
      const [listId, elementId] = idPair(entry["1456"]);
      log("entry 1456", { listId, elementId, raw: entry["1456"] });
      if (!listId || !elementId) continue;
      const mailRes = await request(
        "GET",
        `${BASE}/rest/tutanota/mail/${listId}/${elementId}`,
        {
          token,
          version: MAIL_V,
          dependsOn: MAIL_DV,
        },
      );
      const mail = mailRes.json;
      log("mail", {
        status: mailRes.status,
        keys: keysOf(mail),
        owner587: firstId(mail?.["587"]),
        enc102len: String(mail?.["102"] ?? "").length,
        ver1395: mail?.["1395"],
        received107: mail?.["107"],
        fromPlain: firstObject(mail?.["111"])?.["95"],
        body115: mail?.["115"],
        attachments117: mail?.["117"],
        mailDetails1308: mail?.["1308"],
        sets1465: mail?.["1465"],
      });

      const owner = firstId(mail?.["587"]);
      const groupKey =
        owner === mailGroupId
          ? mg.key
          : owner === firstId(userGroup["29"])
            ? ug.key
            : null;
      let subject = "";
      let fromName = "";
      if (groupKey && mail?.["102"]) {
        try {
          const sk = decryptKey(groupKey, mail["102"]);
          subject = decryptString(mail["105"], sk.key);
          fromName = decryptString(
            firstObject(mail["111"])?.["94"] ?? "",
            sk.key,
          );
        } catch (e) {
          subject = `[session unwrap fail: ${e.message}]`;
        }
      }
      const fromAddr = firstObject(mail?.["111"])?.["95"] ?? "";
      log("DECrypted header", {
        from: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
        subject,
      });
      const [archiveId, detailsElementId] = idPair(mail?.["1308"]);

      let bodyText = "";
      if (archiveId && detailsElementId && groupKey && mail?.["102"]) {
        try {
          const sk = decryptKey(groupKey, mail["102"]);
          const loaded = await loadMailDetailsBlob({
            token,
            archiveId,
            instanceId: detailsElementId,
            sessionKey: sk.key,
          });
          bodyText = loaded.text || "";
          log("DECrypted body", {
            subject,
            status: loaded.status,
            chars: bodyText.length,
            hasTotalCharged: /TOTAL CHARGED/i.test(bodyText),
            has474: bodyText.includes("47.74"),
            head: bodyText.replace(/\s+/g, " ").slice(0, 240),
          });
        } catch (e) {
          log("body hop error", { message: e.message });
        }
      }
      totalListed += 1;

    }
  }

  log("RESULT", { folders: folders.length, decryptedHeaders: totalListed });
  if (totalListed === 0) {
    console.error(
      "FAIL: no messages listed. Dump above shows which hop went empty.",
    );
    process.exit(2);
  }
  console.log("\nPASS: listed at least one mail header.");
}

main().catch((e) => {
  console.error("POC crashed:", e);
  process.exit(1);
});
