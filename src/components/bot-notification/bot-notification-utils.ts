import { isDbotRTL } from '@/external/bot-skeleton/utils/workspace';
import { localize } from '@deriv-com/translations';

export type NotificationType =
    | 'default'
    | 'info'
    | 'success'
    | 'warning'
    | 'error';

export type NotificationPosition =
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';

export type TNotificationContent = {
    message: string;
    primary_action?: TAction;
    closeToast?: () => void;
};

export type TAction = {
    label: string;
    onClick: (closeToast?: () => void) => void;
};

export type TNotificationStyle = {
    type: NotificationType;
    position: NotificationPosition;
    autoClose: number;
    hideProgressBar: boolean;
    closeOnClick: boolean;
    pauseOnHover: boolean;
    pauseOnFocusLoss: boolean;
    closeButton: boolean;
    className?: string;
};

const getNotificationPosition = (): NotificationPosition => {
    const is_RTL = isDbotRTL();

    if (is_RTL) {
        return 'bottom-right';
    }

    return 'bottom-left';
};

export enum NOTIFICATION_TYPE {
    BOT_IMPORT = 'BOT_IMPORT',
    BOT_DELETE = 'BOT_DELETE',
}

export const notification_message = () => ({
    bot_stop: localize(
        'Bot stopped. Check Reports for contract history'
    ),

    workspace_change: localize(
        'Changes you make will not affect your running bot.'
    ),

    block_delete: localize(
        'You’ve just deleted a block.'
    ),

    invalid_xml: localize(
        'Your import failed due to an invalid file. Upload a complete file in XML format.'
    ),

    [NOTIFICATION_TYPE.BOT_IMPORT]: localize(
        'You’ve successfully imported a bot.'
    ),

    [NOTIFICATION_TYPE.BOT_DELETE]: localize(
        'You’ve successfully deleted a bot.'
    ),

    strategy_conversion: localize(
        'Save this strategy as an XML file from Deriv Bot for faster re-imports.'
    ),

    google_drive_error: localize(
        'Your session has expired. Please sign in again.'
    ),

    xml_import_error: localize(
        'Unsupported file format. Please import a valid file.'
    ),
});

export const notification_style: TNotificationStyle = {
    type: 'default',

    position: getNotificationPosition(),

    autoClose: 6000,

    hideProgressBar: true,

    closeOnClick: false,

    pauseOnHover: true,

    pauseOnFocusLoss: false,

    closeButton: true,
};
