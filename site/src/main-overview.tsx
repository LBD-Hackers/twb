import { createRoot } from 'react-dom/client';
import './brand.css';
import './styles.css';
import { LANG } from './copy';
import { modelCopy } from './model/copy';
import { DataModelPage } from './model/DataModel';
import { Shell } from './Shell';

const m = modelCopy.nav;

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
