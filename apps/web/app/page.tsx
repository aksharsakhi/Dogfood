import { getApiHealth } from '../lib/api';
export const dynamic = 'force-dynamic';
export default async function HomePage() {
  const healthy = await getApiHealth().then(
    () => true,
    () => false,
  );
  return (
    <main>
      <p className="eyebrow">Run your next hackathon with Dogfood</p>
      <h1>
        Great ideas deserve
        <br />a fair starting line.
      </h1>
      <p>
        Dogfood brings events, teams, and submissions into one self-hostable
        platform.
      </p>
      <p>
        <a href="/events">Browse events</a>
      </p>
      <section aria-labelledby="status-title">
        <h2 id="status-title">Platform status</h2>
        <p>
          Create an event, form a team, submit a project, and share a gallery
          when it is ready.
        </p>
        <p role="status">
          <span className={healthy ? 'dot online' : 'dot'} />
          API {healthy ? 'online' : 'unavailable'}
        </p>
      </section>
    </main>
  );
}
