export function checkLoginCodes(login, issuer, erasure, flows, config, manifest, adapter) {
 const require = (source, parts, message) => { if(parts.some(part=>!source.includes(part))) throw new Error(message); };
 require(issuer,['Interaction: 1200,'],"OAuth interactions must outlive the browser flow plus a late email code");
 require(adapter,['model === "Interaction" ? 1200'],"The adapter must preserve the full interaction lifetime");
 if (/ip: string|key: "ip:"/.test(login)) throw new Error("Login budgets must not share the relay socket address");
 require(login,['createHmac("sha256", this.key)','randomInt(0, 1000000)','timingSafeEqual','attempts<5 AND','accepted AND','expires_at>clock_timestamp()','DELETE FROM login_challenges WHERE state=$1','browser=$2 AND purpose=$3','pg_advisory_xact_lock(80110)','if (!delivery.canSubmit) throw new LoginRefused','AbortSignal.timeout(submitLimitMilliseconds)','submission.kind !== "accepted"'],"Login codes require keyed random single-use browser-purpose proofs, bounded attempts, database expiry and accepted mail");
 require(login,['limit: 80 }','limit: 3 }','login_mail_budget','suppressed_at>=to_timestamp'],"Login mail requires separate address and daily budgets below the free quota and stale-address suppression");
 require(issuer,['login.consume(digest(state), flow.browser, flow.context.stage','req.headers.origin !== issuer','login.session(secret, issuer)','stage: "login", uid: ""','LoginRefused("Sign-in requires a mail key")'],"Login completion requires same-origin browser proof and configured mail; only OAuth login reuses sessions");
 require(flows,['initiatedAt = value.initiatedAt ??','clock_timestamp()'],"Login starts use the database clock and survive resends");
 require(erasure,['INSERT INTO login_suppression','DELETE FROM login_addresses','SELECT state FROM login_challenges','pg_advisory_xact_lock(80110)'],"Erasure removes credentials, challenges and sessions and suppresses stale address flows");
 require(config,['loginMailKey:','loginMailFrom:'],"Declare local login mail configuration");
 if (/upstreamIssuer|upstreamClient|openid-client|upstreamRedirect|\/upstream\/callback/.test(issuer+config+manifest)) throw new Error("Remove the upstream identity hop");
}
