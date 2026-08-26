import { extractIconsFromHtml } from "../htmlIconExtractor";

const XAI_HOME_HTML = `
<html>
  <head>
    <link rel="icon" href="/icon.png" type="image/png" sizes="512x512" />
    <link rel="apple-touch-icon" href="/apple-icon.png" />
    <meta property="og:image" content="https://x.ai/images/news/grok-bot-more-plans-og.webp" />
    <meta name="twitter:image" content="https://x.ai/images/news/grok-bot-more-plans-og.webp" />
  </head>
  <body>
    <img
      src="/images/news/grok-bot-more-plans-og.webp"
      srcset="/images/news/grok-bot-more-plans-og.webp 5120w"
      alt="Grok Bot more plans"
    />
    <img
      src="/images/news/gemini-enterprise-agent-platform-og.webp"
      srcset="/images/news/gemini-enterprise-agent-platform-og.webp 5120w"
      alt="Gemini Enterprise Agent Platform"
    />
  </body>
</html>
`;

describe("extractIconsFromHtml (official homepage)", () => {
  it("keeps x.ai link-rel icons and drops news/OG photos", () => {
    const icons = extractIconsFromHtml(XAI_HOME_HTML, "https://x.ai");
    const urls = icons.map((i) => i.url);

    expect(urls).toContain("https://x.ai/icon.png");
    expect(urls).toContain("https://x.ai/apple-icon.png");
    expect(
      urls.some((u) => u.includes("/images/news/") || u.includes("-og.webp")),
    ).toBe(false);

    expect(icons.find((i) => i.url === "https://x.ai/icon.png")?.source).toBe(
      "favicon",
    );
    expect(
      icons.find((i) => i.url === "https://x.ai/apple-icon.png")?.source,
    ).toBe("apple_touch_icon");
  });

  it("still keeps apple-touch / logo img on a typical homepage", () => {
    const html = `
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      <img src="/assets/logo.svg" alt="Brand logo" />
      <meta property="og:image" content="https://proton.me/share-card.jpg" />
    `;
    const icons = extractIconsFromHtml(html, "https://proton.me");
    const urls = icons.map((i) => i.url);
    expect(urls).toContain("https://proton.me/apple-touch-icon.png");
    expect(urls).toContain("https://proton.me/assets/logo.svg");
    expect(urls).not.toContain("https://proton.me/share-card.jpg");
  });
});
