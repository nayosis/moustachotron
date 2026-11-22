/** Le logo : un toit et une moustache sur fond `marque` (même dessin que public/icone.svg). */
export function Logo({ taille = 28 }: { taille?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--mantine-color-marque-7)" />
      <path d="M15 27 32 14l17 13" fill="none" stroke="#f3efe6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M32 36c-4-6-12-8-18-4-4 3-5 9-1 11-2-3 0-6 3-6 5 0 9 6 16 2 7 4 11-2 16-2 3 0 5 3 3 6 4-2 3-8-1-11-6-4-14-2-18 4z" fill="#f3efe6" />
    </svg>
  );
}
