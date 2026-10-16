import { createRoot } from 'react-dom/client';
import './brand.css';
import './styles.css';
import { BASE, LANG } from './copy';
import { modelCopy } from './model/copy';
import { DataModelPage } from './model/DataModel';
import { Shell } from './Shell';

const m = modelCopy.nav;

// A term's IRI, https://w3id.org/twb#Surface, reaches a browser here with its fragment: the term
// is described on the reference page, at the same anchor. The page's own sections stay here.
const hash = decodeURIComponent(location.hash.slice(1));
const SECTIONS = /^(begreber|vaeglinjen|moduler|modul-[\w-]+|skema|eksempler|regeltjek|aabent)$/;
if (/^[A-Za-z][\w-]*$/.test(hash) && !SECTIONS.test(hash)) {
    location.replace(`${BASE}reference/#${encodeURIComponent(hash)}`);
}

createRoot(document.getElementById('root')!).render(
    <Shell
        page="overview"
        nav={[
            { href: '#begreber', label: m.concepts[LANG] },
            { href: '#moduler', label: m.modules[LANG] },
            { href: '#skema', label: m.schema[LANG] },
            { href: '#eksempler', label: m.examples[LANG] },
            { href: '#regeltjek', label: m.checks[LANG] },
        ]}
    >
        <DataModelPage lang={LANG} />
    </Shell>
);
