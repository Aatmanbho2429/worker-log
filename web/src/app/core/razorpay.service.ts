import { Injectable, NgZone, inject } from '@angular/core';

/**
 * Loads Razorpay's checkout widget and turns its callback-shaped API into a
 * promise.
 *
 * This is the one file in the app that reaches a third-party host from
 * `web/` — every other network call, including the one that opens the order
 * this widget checks out, goes through Rust. It cannot be otherwise here: a
 * card form has to run in a browser context Rust does not have, and what
 * this widget is handed (`keyId`) is Razorpay's *publishable* key — safe to
 * put in a webview, unlike the key secret, which never leaves the
 * `create-order` / `verify-payment` edge functions.
 *
 * The widget calls back outside Angular's zone, the same reason
 * `ZoneWrapperService` exists for Tauri's own `invoke`/`listen` — so every
 * settle point here re-enters through `NgZone.run`.
 */
@Injectable({ providedIn: 'root' })
export class RazorpayService {
  private readonly zone = inject(NgZone);

  private static readonly SCRIPT_ID = 'razorpay-checkout-script';
  private static readonly SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

  /** Cached across calls so a second `open()` never injects the script twice. */
  private scriptLoad: Promise<void> | null = null;

  /**
   * Opens the widget and resolves with the three fields `auth_verify_payment`
   * needs once Razorpay reports success. Rejects with a {@link RazorpayCancelled}
   * on a closed modal, a failed charge, or a script that could not load —
   * never a plain `Error`, so a caller can branch on {@link RazorpayCancelled.reason}
   * without parsing a message string.
   */
  async open(options: RazorpayCheckoutOptions): Promise<RazorpayPaymentResult> {
    await this.loadScript();
    return this.launch(options);
  }

  private loadScript(): Promise<void> {
    if (razorpayGlobal()) {
      return Promise.resolve();
    }
    if (!this.scriptLoad) {
      this.scriptLoad = new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.id = RazorpayService.SCRIPT_ID;
        script.src = RazorpayService.SCRIPT_SRC;
        script.onload = () => this.zone.run(resolve);
        script.onerror = () => {
          // Let a retry try again rather than caching a failure forever —
          // this machine's own network trouble at this moment is not proof
          // the gateway will never load.
          this.scriptLoad = null;
          this.zone.run(() => reject(new RazorpayCancelled('gatewayUnavailable')));
        };
        document.body.appendChild(script);
      });
    }
    return this.scriptLoad;
  }

  private launch(options: RazorpayCheckoutOptions): Promise<RazorpayPaymentResult> {
    const Razorpay = razorpayGlobal();
    if (!Razorpay) {
      // The CSP silently drops the script tag rather than throwing, so a
      // missing global after `loadScript` resolved means the browser never
      // ran it — worth a distinct reason from a network failure.
      return Promise.reject(new RazorpayCancelled('gatewayUnavailable'));
    }

    return new Promise<RazorpayPaymentResult>((resolve, reject) => {
      const instance = new Razorpay({
        key: options.keyId,
        amount: options.amount,
        currency: options.currency,
        name: options.name,
        description: options.description,
        order_id: options.orderId,
        prefill: options.prefill,
        theme: { color: options.themeColor },
        modal: {
          ondismiss: () => this.zone.run(() => reject(new RazorpayCancelled('dismissed'))),
        },
        handler: (response) => {
          this.zone.run(() =>
            resolve({
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            }),
          );
        },
      });

      instance.on('payment.failed', () =>
        this.zone.run(() => reject(new RazorpayCancelled('paymentFailed'))),
      );
      instance.open();
    });
  }
}

/** Why {@link RazorpayService.open} did not resolve with a payment. */
export type RazorpayCancelReason = 'dismissed' | 'paymentFailed' | 'gatewayUnavailable';

/**
 * Not every non-resolution is a failure worth telling the operator about —
 * `dismissed` means they closed the modal themselves, which
 * `Profile.selectPlan` treats as silence rather than an error toast.
 */
export class RazorpayCancelled extends Error {
  constructor(readonly reason: RazorpayCancelReason) {
    super(`Razorpay checkout did not complete: ${reason}`);
    this.name = 'RazorpayCancelled';
  }
}

export interface RazorpayCheckoutOptions {
  orderId: string;
  /** Paise, an integer — `RazorpayOrder.amount` as `auth_create_order` returned it. */
  amount: number;
  currency: string;
  keyId: string;
  name: string;
  description: string;
  prefill: { name: string; email: string; contact: string };
  /** A hex colour, unrelated to the app's own theme tokens — this widget is Razorpay's own surface. */
  themeColor: string;
}

export interface RazorpayPaymentResult {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

// ------------------------------------------------------------- the widget --
//
// Razorpay ships no types of its own; this is the slice of `checkout.js`'s
// API actually called above, typed by hand rather than reaching for `any`.

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: () => void): void;
}

interface RazorpayConfig {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  modal: { ondismiss: () => void };
  handler: (response: RazorpayHandlerResponse) => void;
}

type RazorpayConstructor = new (config: RazorpayConfig) => RazorpayInstance;

function razorpayGlobal(): RazorpayConstructor | undefined {
  return (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
}
