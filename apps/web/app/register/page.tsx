import { AuthForm } from '../../components/auth-form';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const next =
    typeof params?.next === 'string'
      ? params.next
      : Array.isArray(params?.next)
        ? params?.next[0]
        : undefined;

  return (
    <main>
      <AuthForm mode="register" initialNext={next} />
    </main>
  );
}
