import { usePageTitle } from '../hooks/usePageTitle';
import { LegalPage } from '../features/legal/LegalPage';

const CONTACT_EMAIL = 'mayur@futile.studio';

export function PrivacyPage() {
  usePageTitle('Privacy Policy');
  return (
    <LegalPage title="Privacy Policy" lastUpdated="October 1, 2026">
      <section>
        <h2>1. Introduction</h2>
        <p>
          This Privacy Policy explains how Chorusify ("Chorusify," "we," "us," or "our") collects,
          uses, and discloses information when you use the Chorusify website and service (the
          "Service"). It is intended to describe our practices accurately; it does not describe
          practices we do not actually follow.
        </p>
      </section>

      <section>
        <h2>2. Information We Collect</h2>

        <h3>2.1 Account Information</h3>
        <p>
          If you register for an account, we collect and store your email address, your chosen
          display name, and a cryptographically hashed representation of your password (using the
          Argon2id algorithm). We do not store your password in plain text, and we cannot recover
          it; a forgotten password must be reset, not retrieved.
        </p>

        <h3>2.2 Guest Identification</h3>
        <p>
          If you use the Service without registering, we assign your browser a randomly generated
          guest identifier, stored via a cookie (see Section 5, "Cookies"). This lets your stats and
          streak carry over between visits on the same browser without requiring an account. If you
          later register, your guest history is merged into your new account.
        </p>

        <h3>2.3 Gameplay Information</h3>
        <p>
          We store the games you play and their outcomes: rounds completed, songs guessed correctly,
          guess counts, time taken, streaks, and similar statistics, associated with your account or
          guest identifier. If you use the friends feature, we store your friendship connections and
          the content of messages you send to friends through the Service.
        </p>

        <h3>2.4 Server Logs</h3>
        <p>
          Our servers automatically log request metadata for operational and security purposes,
          including your IP address, browser user agent, the page or endpoint requested, and the
          time of the request. We do not currently define an automatic deletion schedule for these
          logs.
        </p>
      </section>

      <section>
        <h2>3. How We Use Information</h2>
        <p>We use the information described above to:</p>
        <ul>
          <li>Operate the Service, including authenticating you and maintaining your session;</li>
          <li>Track your gameplay statistics, streaks, and leaderboard standing;</li>
          <li>Enable the friends and messaging features you choose to use;</li>
          <li>Diagnose technical problems and defend against abuse of the Service;</li>
          <li>Communicate with you about your account when necessary.</li>
        </ul>
        <p>
          We do not use your information for advertising, and we do not sell your information to
          third parties.
        </p>
      </section>

      <section>
        <h2>4. Third-Party Services</h2>
        <p>
          The Service retrieves song search results and preview audio from Deezer's public API.
          Search queries you type (song or artist names) are sent to Deezer to return results; we do
          not send Deezer your email, display name, or any other identifying information. Use of
          Deezer-provided content is subject to{' '}
          <a href="https://www.deezer.com" target="_blank" rel="noreferrer">
            Deezer's
          </a>{' '}
          own terms.
        </p>
        <p>
          We do not currently use any analytics, advertising, or tracking service, and no such third
          party receives data about your use of the Service.
        </p>
      </section>

      <section>
        <h2>5. Cookies</h2>
        <p>
          We use cookies to operate the Service; see our <a href="/cookies">Cookie Policy</a> for a
          full list of the cookies we set and why.
        </p>
      </section>

      <section>
        <h2>6. Data Retention</h2>
        <p>
          We retain account and gameplay information for as long as your account exists. Guest
          information is retained for as long as the associated cookie persists on your browser (up
          to 30 days of inactivity, after which your session expires) or until merged into a
          registered account.
        </p>
      </section>

      <section>
        <h2>7. Your Rights and Choices</h2>
        <p>
          You can update your display name and password at any time from your profile page. We do
          not currently offer a self-service option to change your email address or to permanently
          delete your account. To request access to, correction of, or deletion of your personal
          information, contact us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We
          will respond to and act on reasonable requests, but because deletion is currently a manual
          process, it may take some time to complete.
        </p>
      </section>

      <section>
        <h2>8. Children's Privacy</h2>
        <p>
          The Service is not directed to, and we do not knowingly collect personal information from,
          children under the age of 13. If you believe a child under 13 has provided us with
          personal information, contact us at{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will take reasonable steps
          to delete it.
        </p>
      </section>

      <section>
        <h2>9. Security</h2>
        <p>
          We use industry-standard measures to protect your information, including hashing passwords
          with Argon2id, serving the Service over HTTPS, and storing session tokens in cookies
          inaccessible to JavaScript. No method of transmission or storage is perfectly secure, and
          we cannot guarantee absolute security.
        </p>
      </section>

      <section>
        <h2>10. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. We will update the "Last updated"
          date above when we do. Continued use of the Service after a change constitutes acceptance
          of the revised policy.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Questions about this Privacy Policy can be sent to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
