import {
    buildAuthorizationUrl,
    buildSignUpUrl,
    getAuthInfo,
    parseReferralLink,
    parseLandingParams,
    resolveReferralViaProxy,
} from '@/external/deriv-core';
import type { AuthConfig } from '@/external/deriv-core';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import brandConfig from '../../../../../brand.config.json';

// =============================================================================
// Constants - Domain & Server Configuration
// =============================================================================

export const PRODUCTION_DOMAINS = {
    COM: brandConfig.platform.hostname.production.com,
} as const;

export const STAGING_DOMAINS = {
    COM: brandConfig.platform.hostname.staging.com,
} as const;

// WebSocket server URLs
export const WS_SERVERS = {
    STAGING: `${brandConfig.platform.derivws.url.staging.replace(/^https:/, 'wss:')}options/ws/public`,
    PRODUCTION: `${brandConfig.platform.derivws.url.production.replace(/^https:/, 'wss:')}options/ws/public`,
} as const;

// =============================================================================
// Helper Functions
// =============================================================================

export const isProduction = () => {
    const env = process.env.NEXT_PUBLIC_DERIV_ENV;

    if (env === 'production') return true;

    if (env === 'preview' || env === 'staging') return false;

    const hostname = window.location.hostname;

    const productionDomains = Object.values(PRODUCTION_DOMAINS) as string[];

    return productionDomains.includes(hostname);
};

export const isLocal = () =>
    /localhost(:\d+)?$/i.test(window.location.hostname);

const getDefaultServerURL = () => {
    const isProductionEnv = isProduction();

    try {
        return isProductionEnv
            ? WS_SERVERS.PRODUCTION
            : WS_SERVERS.STAGING;
    } catch (error) {
        console.error(
            'Error in getDefaultServerURL:',
            error
        );
    }

    return isProductionEnv
        ? WS_SERVERS.PRODUCTION
        : WS_SERVERS.STAGING;
};

// =============================================================================
// Authenticated WebSocket
// =============================================================================

export const getSocketURL = async (): Promise<string> => {
    try {
        const authInfo = getAuthInfo();

        if (!authInfo || !authInfo.access_token) {
            return getDefaultServerURL();
        }

        const wsUrl =
            await DerivWSAccountsService.getAuthenticatedWebSocketURL(
                authInfo.access_token
            );

        return wsUrl;
    } catch (error) {
        console.error(
            '[DerivWS] Error in getSocketURL:',
            error
        );

        return getDefaultServerURL();
    }
};

// =============================================================================
// Debug
// =============================================================================

export const getDebugServiceWorker = () => {
    const debug_service_worker_flag =
        window.localStorage.getItem(
            'debug_service_worker'
        );

    if (debug_service_worker_flag) {
        return !!parseInt(
            debug_service_worker_flag
        );
    }

    return false;
};

// =============================================================================
// OAuth
// =============================================================================

/**
 * Generates the OAuth Login or Sign Up URL.
 *
 * LOGIN:
 * - Uses standard OAuth2 + PKCE only.
 * - NO referral / affiliate / UTM parameters.
 *
 * SIGN UP:
 * - Uses OAuth2 + PKCE.
 * - May include referral / affiliate / UTM parameters.
 */
export const generateOAuthURL = async (
    prompt?: string
): Promise<string> => {
    try {
        const clientId =
            process.env.NEXT_PUBLIC_DERIV_APP_ID;

        if (!clientId) {
            console.error(
                '[OAuth] NEXT_PUBLIC_DERIV_APP_ID is missing.'
            );

            return '';
        }

        const config: AuthConfig = {
            clientId,

            redirectUri:
                `${window.location.origin}/prediction-r75/`,

            scopes: 'trade',
        };

        // =============================================================
        // LOGIN
        // =============================================================
        //
        // IMPORTANT:
        // Login must use the standard OAuth2 + PKCE flow.
        //
        // We intentionally DO NOT add:
        // - affiliateToken
        // - affiliateTokenParam
        // - utmSource
        // - utmMedium
        // - utmCampaign
        //
        // Deriv's OAuth documentation specifies that these
        // attribution parameters are for Sign Up.
        //
        if (prompt !== 'registration') {
            return await buildAuthorizationUrl(
                config
            );
        }

        // =============================================================
        // SIGN UP
        // =============================================================
        //
        // Referral / affiliate parameters are allowed for registration.
        //

        const referralLink =
            process.env.NEXT_PUBLIC_DERIV_REFERRAL_LINK;

        if (referralLink) {
            const referral =
                parseReferralLink(referralLink);

            if (referral) {
                config.affiliateToken =
                    referral.affiliateToken;

                config.affiliateTokenParam =
                    referral.affiliateTokenParam;

                config.utmCampaign =
                    referral.utmCampaign;

                if (referral.utmSource) {
                    config.utmSource =
                        referral.utmSource;
                }

                if (referral.utmMedium) {
                    config.utmMedium =
                        referral.utmMedium;
                }
            }
        }

        // =============================================================
        // Live landing-page referral parameters
        // =============================================================

        const landing =
            parseLandingParams();

        if (landing) {
            if (landing.affiliateToken) {
                config.affiliateToken =
                    landing.affiliateToken;

                config.affiliateTokenParam =
                    landing.affiliateTokenParam;
            }

            if (landing.utmSource) {
                config.utmSource =
                    landing.utmSource;
            }

            if (landing.utmMedium) {
                config.utmMedium =
                    landing.utmMedium;
            }

            if (landing.utmCampaign) {
                config.utmCampaign =
                    landing.utmCampaign;
            }
        }

        // =============================================================
        // Resolve referral through BFF if necessary
        // =============================================================

        if (
            !config.affiliateToken &&
            referralLink
        ) {
            const resolved =
                await resolveReferralViaProxy(
                    referralLink
                );

            if (resolved) {
                config.affiliateToken =
                    resolved.affiliateToken;

                config.affiliateTokenParam =
                    resolved.affiliateTokenParam;

                if (resolved.utmSource) {
                    config.utmSource =
                        resolved.utmSource;
                }

                if (resolved.utmMedium) {
                    config.utmMedium =
                        resolved.utmMedium;
                }

                if (resolved.utmCampaign) {
                    config.utmCampaign =
                        resolved.utmCampaign;
                }
            }
        }

        return await buildSignUpUrl(
            config
        );
    } catch (error) {
        console.error(
            '[OAuth] Error generating OAuth URL:',
            error
        );

        return '';
    }
};
