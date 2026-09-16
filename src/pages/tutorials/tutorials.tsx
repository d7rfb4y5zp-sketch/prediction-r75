// @ts-nocheck

import React from 'react';
import { observer } from 'mobx-react-lite';
import GuideContent from './guide-content';

const TutorialsTab = observer(({ handleTabChange }) => {
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

            <div
                style={{
                    marginTop: '20px',
                    padding: '16px',
                    borderRadius: '10px',
                    background: '#f9fafb',
                }}
            >
                <GuideContent handleTabChange={handleTabChange} />
            </div>
        </div>
    );
});

export default TutorialsTab;
