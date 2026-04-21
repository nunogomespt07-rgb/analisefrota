# Frontend Security Hardening (Static Hosting)

This project is a static website with local JavaScript (`script.js`) and no third-party runtime scripts.

## Quick Findings

- No exposed API keys, tokens, or secrets were found in HTML/JS files.
- All links using `target="_blank"` already include `rel="noopener noreferrer"`.
- No inline event-handler patterns were found (e.g. `onclick=`, `onload=`, `javascript:` URLs).
- External script usage is minimal and necessary:
  - `application/ld+json` blocks for SEO structured data
  - local simulator script (`/script.js` or `script.js`)

## Recommended Hosting-Level Security Headers

Apply these at CDN/server level (Netlify/Vercel/Nginx/Cloudflare/etc.).

### 1) Content-Security-Policy (CSP)

Start with:

```http
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; form-action 'self' https://formspree.io; upgrade-insecure-requests
```

Notes:
- `style-src 'unsafe-inline'` is kept for compatibility with current static markup/CSS workflows.
- `form-action` includes `https://formspree.io` because PT contact form posts there.
- If you later add analytics/tag managers, update `script-src`/`connect-src` explicitly.

### 2) X-Frame-Options

```http
X-Frame-Options: DENY
```

### 3) X-Content-Type-Options

```http
X-Content-Type-Options: nosniff
```

### 4) Referrer-Policy

```http
Referrer-Policy: strict-origin-when-cross-origin
```

### 5) Permissions-Policy

Disable browser features not required by this landing page:

```http
Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()
```

## Optional Additional Headers

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

Use with care if your deployment later needs cross-origin integrations.

## Validation Checklist After Enabling Headers

- Homepage (`/`) loads with correct fonts and styles.
- EN page (`/en/`) and article pages load without CSP violations.
- Simulator works normally (inputs, results, toggles).
- PT contact form submission to Formspree still works.
- Browser console shows no blocked required resources.
