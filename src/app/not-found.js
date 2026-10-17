import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex min-h-64 max-w-lg flex-col items-start justify-center gap-4 p-6">
      <p className="text-sm font-semibold">TEPSY · 404</p>
      <h1 className="text-2xl font-semibold">Sayfa bulunamadı / Page not found</h1>
      <Link href="/" className="primary-action px-4">
        Çalışma alanına dön / Go to workspace
      </Link>
    </section>
  );
}
