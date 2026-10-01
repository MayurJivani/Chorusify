import { usePageTitle } from '../hooks/usePageTitle';
import { LegalPage } from '../features/legal/LegalPage';

const CONTACT_EMAIL = 'mayur@futile.studio';

export function TermsPage() {
  usePageTitle('Terms of Service');
  return (
    <LegalPage title="Terms of Service" lastUpdated="October 1, 2026">
      <section>
        <h2>1. Acceptance of Terms</h2>
        <p>
          These Terms of Service ("Terms") govern your access to and use of Chorusify ("Chorusify,"
          "we," "us," or "our") and the Chorusify website and service (the "Service"). By accessing
          or using the Service, you agree to be bound by these Terms. If you do not agree, do not
          use the Service.
        </p>
      </section>

      <section>
        <h2>2. Eligibility</h2>
        <p>
          The Service is not directed to children under the age of 13, and you must be at least 13
          years old to use it. If you are under the age of majority in your jurisdiction, you may
          only use the Service with the involvement of a parent or guardian.
        </p>
      </section>

      <section>
        <h2>3. Accounts and Guest Use</h2>
        <p>
          You may use the Service without registering, in which case your activity is associated
          with an anonymous guest identifier rather than an account. If you register an account, you
          are responsible for maintaining the confidentiality of your password and for all activity
          that occurs under your account. You agree to provide accurate information and to notify us
          if you become aware of unauthorized use of your account.
        </p>
      </section>

      <section>
        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            Use automated means (bots, scripts, scrapers) to play the Service, inflate leaderboard
            standings, or extract data beyond ordinary use;
          </li>
          <li>Attempt to gain unauthorized access to the Service or other users' accounts;</li>
          <li>
            Use the friends/messaging feature to harass, abuse, or send unlawful content to other
            users;
          </li>
          <li>Interfere with or disrupt the integrity or performance of the Service;</li>
          <li>Use the Service for any unlawful purpose.</li>
        </ul>
        <p>
          We may suspend or terminate access for any account or guest session that violates these
          Terms.
        </p>
      </section>

      <section>
        <h2>5. Content and Intellectual Property</h2>
        <p>
          Song previews, artwork, and metadata displayed in the Service are provided by{' '}
          <a href="https://www.deezer.com" target="_blank" rel="noreferrer">
            Deezer
          </a>{' '}
          and remain the property of their respective rights holders. The Service uses short preview
          clips solely for the purpose of the guessing game. The Chorusify name, design, and
          software, excluding third-party content, belong to us or our licensors.
        </p>
        <p>
          Content you submit through the Service, such as your display name and messages to friends,
          remains yours, but by submitting it you grant us a license to store and display it as
          necessary to operate the Service.
        </p>
      </section>

      <section>
        <h2>6. Leaderboards and Statistics</h2>
        <p>
          Leaderboard standings and statistics reflect gameplay as recorded by our systems. We
          reserve the right to remove entries, scores, or accounts we reasonably believe were
          obtained through cheating, exploitation of a bug, or violation of these Terms.
        </p>
      </section>

      <section>
        <h2>7. Disclaimers</h2>
        <p>
          The Service is provided "as is" and "as available," without warranties of any kind,
          whether express or implied, including warranties of merchantability, fitness for a
          particular purpose, or non-infringement. We do not warrant that the Service will be
          uninterrupted, error-free, or available at all times.
        </p>
      </section>

      <section>
        <h2>8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Chorusify and its operators will not be liable for
          any indirect, incidental, special, consequential, or punitive damages, or any loss of
          data, arising out of or related to your use of, or inability to use, the Service.
        </p>
      </section>

      <section>
        <h2>9. Termination</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate your access to the
          Service, with or without notice, for conduct that violates these Terms or for any other
          reason at our discretion.
        </p>
      </section>

      <section>
        <h2>10. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. We will update the "Last updated" date above
          when we do. Continued use of the Service after a change constitutes acceptance of the
          revised Terms.
        </p>
      </section>

      <section>
        <h2>11. Contact</h2>
        <p>
          Questions about these Terms can be sent to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
    </LegalPage>
  );
}
