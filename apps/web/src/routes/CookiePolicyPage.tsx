import { usePageTitle } from '../hooks/usePageTitle';
import { LegalPage } from '../features/legal/LegalPage';

const CONTACT_EMAIL = 'mayur@futile.studio';

export function CookiePolicyPage() {
  usePageTitle('Cookie Policy');
  return (
    <LegalPage title="Cookie Policy" lastUpdated="October 1, 2026">
      <section>
        <h2>1. What Cookies We Use</h2>
        <p>
          Chorusify uses a small number of cookies to operate the Service. We do not use advertising
          cookies, and we do not use any third-party analytics or tracking cookies.
        </p>
        <ul>
          <li>
            <strong className="text-slate-100">chorusify_sid</strong> — holds your session token,
            which identifies you (or your guest session) to our server. It is set to expire after 30
            days, is inaccessible to JavaScript ("HttpOnly"), and is marked secure in production so
            it is only sent over HTTPS. Without this cookie, the Service cannot keep you signed in
            or remember your guest statistics between page loads.
          </li>
          <li>
            <strong className="text-slate-100">chorusify_csrf</strong> (named{' '}
            <code>__Host-chorusify.csrf</code> in production) — a security cookie used to verify
            that requests which change data (such as submitting a guess or sending a message)
            actually originated from the Service, protecting you against cross-site request forgery.
            Unlike the session cookie, this one must be readable by the page's own script to work,
            but it is not used to identify or track you across sites.
          </li>
        </ul>
      </section>

      <section>
        <h2>2. Why We Use Them</h2>
        <p>
          Both cookies are "strictly necessary" to the operation of the Service: they exist to keep
          you signed in, preserve your guest stats, and protect the Service against a specific class
          of attack. Neither is used for advertising, profiling, or tracking you across other
          websites.
        </p>
      </section>

      <section>
        <h2>3. Managing Cookies</h2>
        <p>
          Most browsers let you view, delete, or block cookies through their settings. Because the
          cookies described above are required for login and guest-session continuity, blocking them
          will prevent the Service from remembering you between visits, and may prevent it from
          working at all.
        </p>
      </section>

      <section>
        <h2>4. Changes to This Policy</h2>
        <p>
          We may update this Cookie Policy if the cookies we use change. We will update the "Last
          updated" date above when we do.
        </p>
      </section>

      <section>
        <h2>5. Contact</h2>
        <p>
          Questions about this Cookie Policy can be sent to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also our{' '}
          <a href="/privacy">Privacy Policy</a>.
        </p>
      </section>
    </LegalPage>
  );
}
