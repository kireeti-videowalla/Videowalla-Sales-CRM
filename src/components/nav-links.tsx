'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-0.5" aria-label="Main">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
              active ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
