import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

export default function Home() {
  const { data: session } = useSession();
  return (
    <div className="h-screen bg-cover bg-center" style={{ backgroundImage: "url('/background.jpg')" }}>
      <div className="flex flex-col items-center justify-center h-full bg-white/70 backdrop-blur">
        <h1 className="text-4xl font-bold text-green-800 mb-4">Prezenty Świąteczne</h1>
        {!session ? (
          <button onClick={() => signIn("google")} className="bg-red-500 text-white px-4 py-2 rounded">Zaloguj się przez Google</button>
        ) : (
          <>
            <p className="mb-4">Witaj, {session.user.name}</p>
            <Link href="/dodaj" className="text-blue-700 underline mb-2">Dodaj prezent</Link>
            <Link href="/lista" className="text-blue-700 underline">Zobacz listę prezentów</Link>
            <button onClick={() => signOut()} className="mt-4 text-sm text-red-600">Wyloguj się</button>
          </>
        )}
      </div>
    </div>
    );
}
