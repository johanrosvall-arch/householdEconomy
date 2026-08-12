import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';

/**
 * The mock bank's consent page.
 *
 * Stands in for the page a real bank shows during a PSD2 authorisation. It is
 * deliberately a real HTTP page rather than a shortcut, because that is the
 * only way to exercise the part of the flow most likely to break on a device:
 * the browser handing control back to the app via its deep-link scheme.
 *
 * Unauthenticated by necessity — it opens in a plain browser with no bearer
 * token — so it is registered only when BANK_PROVIDER is 'mock', and it does
 * nothing but redirect. No household data is read or written here; the
 * consent's `ref` is opaque and the caller must still be an authenticated
 * member of the household to complete the link.
 */

const consentQuery = z.object({
  ref: z.string().min(1).max(200),
  redirect: z.string().min(1).max(500),
});

/** Only ever redirect to the app's own scheme. */
const ALLOWED_REDIRECT_PREFIX = 'householdeconomy://';

const mockBankRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/consent', async (request, reply) => {
    const query = consentQuery.parse(request.query ?? {});

    // An open redirect here would let anyone bounce a victim off this host to
    // an arbitrary URL, so the target is restricted to the app scheme.
    if (!query.redirect.startsWith(ALLOWED_REDIRECT_PREFIX)) {
      throw badRequest('redirect must target the application scheme');
    }

    const target = `${query.redirect}?ref=${encodeURIComponent(query.ref)}&mock=1`;

    reply.type('text/html; charset=utf-8').send(consentPage(target));
  });
};

function consentPage(target: string): string {
  // Escaped for an HTML attribute; `target` is already validated as our scheme.
  const href = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  return `<!doctype html>
<html lang="sv">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Testbank — godkänn åtkomst</title>
<style>
  :root { color-scheme: dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0B1220; color: #F2F5FA; padding: 24px;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .card {
    background: #141C2B; border: 1px solid #26324A; border-radius: 20px;
    padding: 32px; max-width: 420px; width: 100%;
  }
  h1 { font-size: 20px; margin: 0 0 8px; }
  p { color: #95A2B8; margin: 0 0 16px; }
  ul { color: #95A2B8; padding-left: 20px; margin: 0 0 24px; }
  li { margin-bottom: 6px; }
  .badge {
    display: inline-block; background: #2A3A6B; color: #F2F5FA; font-size: 12px;
    font-weight: 700; padding: 4px 10px; border-radius: 999px; margin-bottom: 16px;
    letter-spacing: .4px;
  }
  a.btn {
    display: block; text-align: center; background: #4C6EF5; color: #fff;
    text-decoration: none; padding: 14px; border-radius: 12px; font-weight: 600;
  }
</style>
</head>
<body>
  <div class="card">
    <span class="badge">TESTBANK — INGEN RIKTIG BANK</span>
    <h1>Godkänn åtkomst till dina konton</h1>
    <p>Hushållsekonomi vill hämta:</p>
    <ul>
      <li>Kontonummer och saldon</li>
      <li>Transaktioner för de senaste 12 månaderna</li>
    </ul>
    <p>Samtycket gäller i 90 dagar och kan återkallas när som helst.</p>
    <a class="btn" href="${href}">Godkänn med BankID</a>
  </div>
</body>
</html>`;
}

export default mockBankRoutes;
