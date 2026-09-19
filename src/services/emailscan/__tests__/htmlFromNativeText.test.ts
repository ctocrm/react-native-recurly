// Phase L: the native bridges never emit `html`; the proton/tuta/imap legs
// must recover it from `text` or the Phase C extractor can never yield
// brand-sent icon seeds (root cause of zero [EMAIL-DIRECT] on proton scans).
import { htmlFromNativeText } from "../imapNative";

describe("htmlFromNativeText (Phase L root-cause fix)", () => {
  it("extracts the quoted-printable html part from a Proton MIME document", () => {
    const mime = [
      'Content-Type: multipart/alternative; boundary="b_abc123"',
      "",
      "--b_abc123",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Your invoice is ready.",
      "--b_abc123",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<html><body><img src=3D"https://acme.com/mail/logo.png" width=3D"120">',
      "<p>Your invoice is ready.</p></body></html>",
      "--b_abc123--",
    ].join("\r\n");
    const html = htmlFromNativeText(mime);
    expect(html).toBeDefined();
    expect(html).toContain(
      '<img src="https://acme.com/mail/logo.png" width="120">',
    );
    expect(html).not.toContain("=3D");
  });

  it("decodes a base64 html part", () => {
    const htmlDoc =
      '<html><body><img src="https://acme.com/logo.png"></body></html>';
    const b64 = Buffer.from(htmlDoc, "utf-8").toString("base64");
    const mime = [
      'Content-Type: multipart/alternative; boundary="xyz"',
      "",
      "--xyz",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      b64,
      "--xyz--",
    ].join("\n");
    expect(htmlFromNativeText(mime)).toContain("https://acme.com/logo.png");
  });

  it("passes a Tuta-style raw HTML body through untouched", () => {
    const body =
      '<html><body><div>Receipt</div><img src="https://tuta.com/i.png"></body></html>';
    expect(htmlFromNativeText(body)).toBe(body);
  });

  it("finds the html part inside nested multipart (mixed → alternative)", () => {
    const inner = [
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      "--inner",
      "Content-Type: text/html; charset=utf-8",
      "",
      '<div><img src="https://acme.com/mail/logo.png"></div>',
      "--inner--",
    ].join("\n");
    const outer = [
      'Content-Type: multipart/mixed; boundary="outer"',
      "",
      "--outer",
      "Content-Type: text/plain",
      "",
      "see attachment",
      "--outer",
      'Content-Type: multipart/alternative; boundary="inner"',
      "",
      inner,
      "--outer--",
    ].join("\r\n");
    expect(htmlFromNativeText(outer)).toContain("acme.com/mail/logo.png");
  });

  it("decodes UTF-8 quoted-printable sequences", () => {
    const mime = [
      'Content-Type: multipart/alternative; boundary="u8"',
      "",
      "--u8",
      "Content-Type: text/html; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "<div>Total =E2=82=AC12.00</div>",
      "--u8--",
    ].join("\n");
    expect(htmlFromNativeText(mime)).toContain("Total €12.00");
  });

  it("returns undefined for plain-text bodies (no invented HTML)", () => {
    expect(
      htmlFromNativeText("Your invoice for March is attached.\nTotal: $5.00"),
    ).toBeUndefined();
    expect(htmlFromNativeText(undefined)).toBeUndefined();
    expect(htmlFromNativeText("")).toBeUndefined();
    expect(htmlFromNativeText("too short")).toBeUndefined();
  });
});