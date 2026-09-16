// @ts-nocheck

import React from 'react';
import { observer } from 'mobx-react-lite';

const TutorialsTab = observer(({ handleTabChange }) => {
    return (
        <div
            id='tutorials-diagnostic'
            style={{
                padding: '24px',
                margin: '20px',
                borderRadius: '12px',
                background: '#ffffff',
                color: '#111827',
                minHeight: '300px',
            }}
        >
            <h2>Tutorials</h2>

            <p>
                Diagnostic Tutorials OK.
            </p>

            <p>
                Si tu vois ce message, le problème vient d'un des composants
                ou imports de l'ancien fichier Tutorials.
            </p>

            <button
                type='button'
                onClick={() => handleTabChange?.(0)}
                style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    cursor: 'pointer',
                }}
            >
                Retour Dashboard
            </button>
        </div>
    );
});

export default TutorialsTab;
