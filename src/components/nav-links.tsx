'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function NavLinks({ items }: { items: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();

  return (
    <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" aria-label="Main">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] transition-colors duration-150 ${
              active
                ? 'bg-brand-600 font-medium text-white'
                : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
