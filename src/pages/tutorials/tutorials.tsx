// @ts-nocheck

import React from 'react';
import { observer } from 'mobx-react-lite';

const TutorialsTab = observer(({ handleTabChange }) => {
    const tabs = [
        'Guide',
        'FAQ',
        'Quick strategy guides',
        'Search',
    ];

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
            <h2 style={{ marginBottom: '20px' }}>
                Tutorials
            </h2>

            <div
                style={{
                    display: 'flex',
                    gap: '8px',
                    flexWrap: 'wrap',
                    marginBottom: '24px',
                }}
            >
                {tabs.map((tab, index) => (
                    <button
                        key={tab}
                        type='button'
                        onClick={() => handleTabChange?.(index)}
                        style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid #d1d5db',
                            background: '#f3f4f6',
                            color: '#111827',
                            cursor: 'pointer',
                        }}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            <div
                style={{
                    padding: '20px',
                    borderRadius: '10px',
                    background: '#f9fafb',
                }}
            >
                <h3>Guide</h3>
                <p>
                    Le système Tutorials fonctionne correctement.
                </p>
                <p>
                    Les contenus Guide, FAQ et Quick Strategy seront
                    réactivés progressivement.
                </p>
            </div>
        </div>
    );
});

export default TutorialsTab;
