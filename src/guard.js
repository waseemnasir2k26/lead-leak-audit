// Endpoint-level safety gate. Classifies what a request would actually DO from its real URL,
// independent of how the DOM described the form. Used at plan time and, more importantly,
// inside the browser's route handler for every outgoing non-GET request and navigation.

const SEG = String.raw`(?:[/_.?&=-]|$)`;

export const FORBIDDEN_ENDPOINTS = [
  {
    kind: "comment",
    why: "comment endpoint",
    re: new RegExp(
      String.raw`wp-comments-post|comment[-_]?post|/comments?${SEG}|[?&]comment`,
      "i",
    ),
  },
  {
    kind: "commerce",
    why: "cart, checkout, order or payment endpoint",
    re: new RegExp(
      String.raw`add[-_]?to[-_]?cart|/cart${SEG}|/basket${SEG}|/checkout${SEG}|/orders?${SEG}|/payments?${SEG}|/pay${SEG}|wc-ajax|/purchase${SEG}|/buy[-_]?now${SEG}|/billing${SEG}`,
      "i",
    ),
  },
  {
    kind: "account",
    why: "account, unsubscribe, delete, login, register or password endpoint",
    re: new RegExp(
      String.raw`unsubscribe|opt[-_]?out|/delete${SEG}|[?&]delete|/account${SEG}|/my-account|/register${SEG}|registration|/passwords?${SEG}|lost[-_]?password|forgot|/reset${SEG}|/log-?in${SEG}|wp-login|/sign-?in${SEG}|/profile${SEG}|/deactivate${SEG}|/cancel${SEG}`,
      "i",
    ),
  },
];

const SIGNUP = new RegExp(String.raw`/sign-?up${SEG}`, "i");

/**
 * @param {string} url absolute URL
 * @param {{robots?: {isAllowed(path:string):boolean}|null, allowSignup?: boolean}} opts
 * @returns {{kind:string, why:string, path:string}|null}
 */
export function forbiddenEndpoint(
  url,
  { robots = null, allowSignup = false } = {},
) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  let target = u.pathname + u.search;
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep raw */
  }
  const path = u.pathname + (u.search ? "?…" : "");
  for (const r of FORBIDDEN_ENDPOINTS)
    if (r.re.test(target)) return { kind: r.kind, why: r.why, path };
  if (!allowSignup && SIGNUP.test(target))
    return {
      kind: "account",
      why: "sign-up endpoint (pass --include-newsletter to allow newsletter sign-ups)",
      path,
    };
  if (robots && !robots.isAllowed(u.pathname + u.search))
    return { kind: "robots", why: "robots.txt disallows this path", path };
  return null;
}
