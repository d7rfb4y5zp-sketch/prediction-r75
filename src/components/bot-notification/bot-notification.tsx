import React from 'react';
import {
    notification_style,
    TAction,
    TNotificationContent,
    TNotificationStyle,
} from './bot-notification-utils';

type NotificationItem = {
    id: number;
    message: string;
    primary_action?: TAction;
    style: Partial<TNotificationStyle>;
};

let notification_id = 0;

const listeners = new Set<(items: NotificationItem[]) => void>();

let notifications: NotificationItem[] = [];

const notifyListeners = () => {
    listeners.forEach(listener => listener([...notifications]));
};

const removeNotification = (id: number) => {
    notifications = notifications.filter(item => item.id !== id);
    notifyListeners();
};

export const NotificationContent: React.FC<
    TNotificationContent & {
        id?: number;
        style?: Partial<TNotificationStyle>;
    }
> = ({ message, primary_action, closeToast, id, style }) => {
    React.useEffect(() => {
        const handleVisibilityChange = () => {
            if (
                document.visibilityState === 'hidden' &&
                id !== undefined
            ) {
                removeNotification(id);
            }
        };

        document.addEventListener(
            'visibilitychange',
            handleVisibilityChange
        );

        return () => {
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange
            );
        };
    }, [id]);

    return (
        <div
            className="notification-content"
            data-testid="dt_bot_notification"
        >
            <div>{message}</div>

            {primary_action && (
                <button
                    type="button"
                    onClick={() => {
                        primary_action.onClick(closeToast);
                    }}
                >
                    {primary_action.label}
                </button>
            )}

            {style?.closeButton !== false && (
                <button
                    type="button"
                    aria-label="Close notification"
                    onClick={() => {
                        if (id !== undefined) {
                            removeNotification(id);
                        }
                    }}
                >
                    ×
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
    const id = ++notification_id;

    const style = {
        ...notification_style,
        ...custom_style,
    };

    const notification: NotificationItem = {
        id,
        message,
        primary_action,
        style,
    };

    notifications = [...notifications, notification];

    notifyListeners();

    if (
        typeof style.autoClose === 'number' &&
        style.autoClose > 0
    ) {
        window.setTimeout(() => {
            removeNotification(id);
        }, style.autoClose);
    }

    return id;
};

export const dismissBotNotification = (id: number) => {
    removeNotification(id);
};

export const NotificationContainer: React.FC = () => {
    const [items, setItems] = React.useState<NotificationItem[]>(
        notifications
    );

    React.useEffect(() => {
        const listener = (nextItems: NotificationItem[]) => {
            setItems(nextItems);
        };

        listeners.add(listener);

        return () => {
            listeners.delete(listener);
        };
    }, []);

    if (!items.length) {
        return null;
    }

    return (
        <div
            className="bot-notification-container"
            data-testid="dt_bot_notification_container"
        >
            {items.map(item => (
                <NotificationContent
                    key={item.id}
                    id={item.id}
                    message={item.message}
                    primary_action={item.primary_action}
                    closeToast={() => removeNotification(item.id)}
                    style={item.style}
                />
            ))}
        </div>
    );
};
