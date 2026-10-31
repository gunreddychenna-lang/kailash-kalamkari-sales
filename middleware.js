const blocked = [
  /^\/(?:payments|crm|attendance|entry)\.html$/i,
  /^\/api\/payments(?:\/|$)/i,
  /^\/api\/replace-settlements(?:\/|$)/i
];

export default function middleware(request) {
  const path = new URL(request.url).pathname;

  // Allow the isolated DEV payment trial in Preview only.
  const isPaymentRoute =
    path === "/payments.html" ||
    path === "/api/payments";

  if (
    ["preview", "production"].includes(process.env.VERCEL_ENV) &&
    isPaymentRoute
  ) {
    return;
  }

  if (blocked.some(pattern => pattern.test(path))) {
    return new Response("Not available in Sales-only release.", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8"
      }
    });
  }
}

export const config = {
  matcher: [
    "/payments.html",
    "/crm.html",
    "/attendance.html",
    "/entry.html",
    "/api/payments",
    "/api/payments/:path*",
    "/api/replace-settlements",
    "/api/replace-settlements/:path*"
  ]
};
