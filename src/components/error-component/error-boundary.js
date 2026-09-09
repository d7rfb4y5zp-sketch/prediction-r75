import React from 'react';
import PropTypes from 'prop-types';
import ErrorComponent from './index';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            hasError: false,
        };
    }

    componentDidCatch = (error, info) => {
        console.error('🔥 ERREUR RÉELLE DE L’APPLICATION :', error);
        console.error('🔥 INFORMATIONS :', info);

        if (window.TrackJS) {
            window.TrackJS.console.log(this.props.root_store);
        }

        this.setState({
            hasError: true,
            error,
            info,
        });
    };

    render = () => {
        if (this.state.hasError) {
            return <ErrorComponent should_show_refresh={true} />;
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
