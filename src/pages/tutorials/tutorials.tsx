// @ts-nocheck

import React from 'react';
import { observer } from 'mobx-react-lite';
import GuideContent from './guide-content';

const TutorialsTab = observer(() => {
    return (
        <div
            style={{
                padding: '20px',
                margin: '16px',
                borderRadius: '12px',
                background: '#ffffff',
                color: '#111827',
                minHeight: '350px',
            }}
        >
            <h2>Tutorials</h2>

            <p>
                Test 3 : GuideContent est importé mais n'est pas affiché.
            </p>

            <p>
                Si cette page fonctionne, le problème est dans le rendu
                de GuideContent.
            </p>

            <p>
                Si l'erreur revient, le problème est dans GuideContent
                ou dans l'un de ses imports.
            </p>
        </div>
    );
});

export default TutorialsTab;
