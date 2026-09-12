"use client";
// Filet de sécurité : une erreur du lecteur affiche un message plutôt qu'une page blanche.
export default function ShareError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen w-full bg-black text-white flex flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm text-gray-300">La lecture de ce partage a échoué.</p>
      <p className="text-[11px] text-gray-500 max-w-md break-words">{error.message}</p>
      <button
        onClick={reset}
        className="mt-2 px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-xs transition"
      >
        Réessayer
      </button>
    </main>
  );
}
