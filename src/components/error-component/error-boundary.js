import React from 'react';
import PropTypes from 'prop-types';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            hasError: false,
            error: null,
        };
    }

    componentDidCatch = (error, info) => {
        console.error('🔥 ERREUR RÉELLE :', error);
        console.error('🔥 INFORMATIONS :', info);

        if (window.TrackJS) {
            window.TrackJS.console.log(this.props.root_store);
        }

        this.setState({
            hasError: true,
            error,
        });
    };

    render = () => {
        if (this.state.hasError) {
            const error = this.state.error;

            return (
                <div
                    style={{
                        minHeight: '100vh',
                        background: '#061321',
                        color: 'white',
                        padding: '30px 20px',
                        fontFamily: 'Arial, sans-serif',
                    }}
                >
                    <h2 style={{ color: '#ff4d6d' }}>
                        ⚠️ Erreur réelle de l'application
                    </h2>

                    <p>
                        L'application a rencontré cette erreur :
                    </p>

                    <pre
                        style={{
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            background: '#0d2945',
                            padding: '15px',
                            borderRadius: '10px',
                            color: '#ffffff',
                            fontSize: '14px',
                        }}
                    >
                     {error?.stack || error?.message || String(error) || 'Erreur inconnue'}
                    </pre>

                    <p style={{ marginTop: '20px', color: '#55a7ff' }}>
                        Envoie-moi une capture de cet écran.
                    </p>
                </div>
            );
        }

        return this.props.children;
    };
}

ErrorBoundary.propTypes = {
    root_store: PropTypes.object,
    children: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.arrayOf(PropTypes.node),
        PropTypes.node,
    ]),
};

export default ErrorBoundary;
