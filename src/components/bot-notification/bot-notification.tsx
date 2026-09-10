import React from 'react';
import {
    notification_style,
    TAction,
    TNotificationStyle,
} from './bot-notification-utils';

type NotificationItem = {
    id: number;
    message: string;
    primary_action?: TAction;
    style: TNotificationStyle;
};

let nextNotificationId = 1;

const activeNotifications = new Map<number, NotificationItem>();

const notifyListeners = new Set<() => void>();

const notifyChange = () => {
    notifyListeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
    notifyListeners.add(listener);

    return () => {
        notifyListeners.delete(listener);
    };
};

const getNotifications = () => Array.from(activeNotifications.values());

const removeNotification = (id: number) => {
    if (!activeNotifications.has(id)) return;

    activeNotifications.delete(id);
    notifyChange();
};

const addNotification = (
    message: string,
    primary_action?: TAction,
    custom_style?: Partial<TNotificationStyle>
) => {
    const id = nextNotificationId++;

    const style: TNotificationStyle = {
        ...notification_style,
        ...custom_style,
    };

    activeNotifications.set(id, {
        id,
        message,
        primary_action,
        style,
    });

    notifyChange();

    if (style.autoClose !== false && typeof style.autoClose === 'number') {
        window.setTimeout(() => {
            removeNotification(id);
        }, style.autoClose);
    }

    return id;
};

const NotificationContent: React.FC<{
    notification: NotificationItem;
    onClose: () => void;
}> = ({ notification, onClose }) => {
    const {
        message,
        primary_action,
        style,
    } = notification;

    const [isHovered, setIsHovered] = React.useState(false);

    React.useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden' && style.pauseOnFocusLoss === false) {
                return;
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [style.pauseOnFocusLoss]);

    const getTypeClass = () => {
        switch (style.type) {
            case 'success':
                return 'bot-notification-success';

            case 'error':
                return 'bot-notification-error';

            case 'warning':
                return 'bot-notification-warning';

            case 'info':
                return 'bot-notification-info';

            default:
                return 'bot-notification-default';
        }
    };

    return (
        <div
            className={`bot-notification-item ${getTypeClass()} ${
                style.className ?? ''
            }`}
            onMouseEnter={() => {
                if (style.pauseOnHover) {
                    setIsHovered(true);
                }
            }}
            onMouseLeave={() => {
                if (style.pauseOnHover) {
                    setIsHovered(false);
                }
            }}
            style={{
                position: 'relative',
                minWidth: '280px',
                maxWidth: '420px',
                marginBottom: '12px',
                padding: '14px 42px 14px 16px',
                borderRadius: '8px',
                background: '#1f2937',
                color: '#ffffff',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.25)',
                fontSize: '14px',
                lineHeight: '1.4',
                opacity: isHovered ? 0.96 : 1,
                transition: 'opacity 0.15s ease',
                zIndex: 99999,
            }}
        >
            {style.closeButton !== false && (
                <button
                    type='button'
                    aria-label='Close notification'
                    onClick={onClose}
                    style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        width: '26px',
                        height: '26px',
                        border: 'none',
                        background: 'transparent',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontSize: '18px',
                        lineHeight: '26px',
                        padding: 0,
                        opacity: 0.75,
                    }}
                >
                    ×
                </button>
            )}

            <div
                className='notification-content'
                data-testid='dt_bot_notification'
            >
                <div>{message}</div>

                {primary_action && (
                    <button
                        type='button'
                        onClick={() => {
                            primary_action.onClick(onClose);
                        }}
                        style={{
                            marginTop: '10px',
                            padding: '7px 12px',
                            border: 'none',
                            borderRadius: '5px',
                            cursor: 'pointer',
                            background: '#ffffff',
                            color: '#111827',
                            fontWeight: 600,
                        }}
                    >
                        {primary_action.label}
                    </button>
                )}
            </div>
        </div>
    );
};

const NotificationContainer: React.FC = () => {
    const [, forceUpdate] = React.useReducer(value => value + 1, 0);

    React.useEffect(() => {
        return subscribe(() => {
            forceUpdate();
        });
    }, []);

    const notifications = getNotifications();

    if (!notifications.length) {
        return null;
    }

    const position = notifications[0]?.style.position ?? 'bottom-left';

    const getContainerStyle = (): React.CSSProperties => {
        const base: React.CSSProperties = {
            position: 'fixed',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'none',
        };

        switch (position) {
            case 'top-left':
                return {
                    ...base,
                    top: '20px',
                    left: '20px',
                };

            case 'top-center':
                return {
                    ...base,
                    top: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                };

            case 'top-right':
                return {
                    ...base,
                    top: '20px',
                    right: '20px',
                };

            case 'bottom-center':
                return {
                    ...base,
                    bottom: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                };

            case 'bottom-right':
                return {
                    ...base,
                    bottom: '20px',
                    right: '20px',
                };

            case 'bottom-left':
            default:
                return {
                    ...base,
                    bottom: '20px',
                    left: '20px',
                };
        }
    };

    return (
        <div
            className='bot-notification-container'
            style={getContainerStyle()}
        >
            {notifications.map(notification => (
                <div
                    key={notification.id}
                    style={{
                        pointerEvents: 'auto',
                    }}
                >
                    <NotificationContent
                        notification={notification}
                        onClose={() => removeNotification(notification.id)}
                    />
                </div>
            ))}
        </div>
    );
};

export const NotificationContent: React.FC<{
    message: string;
    primary_action?: TAction;
    closeToast?: () => void;
}> = ({ message, primary_action, closeToast }) => {
    return (
        <div
            className='notification-content'
            data-testid='dt_bot_notification'
        >
            <div>{message}</div>

            {primary_action && (
                <button
                    type='button'
                    onClick={() => {
                        primary_action.onClick(closeToast);
                    }}
                >
                    {primary_action.label}
                </button>
            )}
        </div>
    );
};

export const botNotification = (
    message: string,
    primary_action?: TAction,
    custom_style?: Partial<TNotificationStyle>
) => {
    return addNotification(
        message,
        primary_action,
        custom_style
    );
};

export { NotificationContainer };
