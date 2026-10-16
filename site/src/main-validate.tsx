import { createRoot } from 'react-dom/client';
import './brand.css';
import './styles.css';
import { Shell } from './Shell';
import { Validate } from './validate/Validate';

createRoot(document.getElementById('root')!).render(
    <Shell page="validate">
        <Validate />
    </Shell>
);
