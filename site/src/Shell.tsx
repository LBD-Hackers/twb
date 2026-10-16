/**
 * The frame every page shares: the header with the pages and the source, and the footer with
 * the licences.
 */

import type { ReactNode } from 'react';
import { BASE, LINKS } from './copy';

export type PageId = 'overview' | 'reference' | 'validate';

const PAGES: { id: PageId; href: string; label: string }[] = [
    { id: 'overview', href: BASE, label: 'Data model' },
    { id: 'reference', href: `${BASE}reference/`, label: 'Reference' },
    { id: 'validate', href: `${BASE}validate/`, label: 'Validate' },
];

function Mark() {
    return (
        <svg viewBox="0 0 24 24" className="mark" aria-hidden>
            <path d="M3 21 L12 3 L21 21" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="12" cy="3.6" r="2.4" fill="currentColor" />
        </svg>
    );
}

export function Shell({
    page,
    nav,
    children,
}: {
    page: PageId;
    /** The page's own sections, as anchors. */
    nav?: { href: string; label: string }[];
    children: ReactNode;
}) {
    return (
        <>
            <header className="site-header">
                <div className="wrap header-row">
                    <a href={BASE} className="brand">
                        <Mark />
                        <span>TWB</span>
                    </a>
                    <nav className="nav" aria-label="Pages">
                        {PAGES.map((p) => (
                            <a
                                key={p.id}
                                href={p.href}
                                className={p.id === page ? 'is-current' : undefined}
                                aria-current={p.id === page ? 'page' : undefined}
                            >
                                {p.label}
                            </a>
                        ))}
                        {nav?.map((n) => (
                            <a key={n.href} href={n.href} className="nav-section">
                                {n.label}
                            </a>
                        ))}
                    </nav>
                    <div className="header-actions">
                        <a href={LINKS.npm} className="link-quiet">
                            npm
                        </a>
                        <a href={LINKS.repo} className="button">
                            GitHub
                        </a>
                    </div>
                </div>
            </header>
            <main>{children}</main>
            <footer className="site-footer">
                <div className="wrap footer-row">
                    <a href={BASE} className="brand">
                        <Mark />
                        <span>TWB — thin-walled blueprints</span>
                    </a>
                    <p>
                        The ontology under CC BY 4.0, the code under Apache-2.0, at{' '}
                        <a href={LINKS.repo}>LBD-Hackers/twb</a>. TWB is the data model of{' '}
                        <a href={LINKS.arch}>arch</a>.
                    </p>
                </div>
            </footer>
        </>
    );
}
