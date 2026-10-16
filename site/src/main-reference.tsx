import { createRoot } from 'react-dom/client';
import './brand.css';
import './styles.css';
import { Reference } from './reference/Reference';
import { Shell } from './Shell';

createRoot(document.getElementById('root')!).render(
    <Shell page="reference">
        <Reference />
    </Shell>
);
