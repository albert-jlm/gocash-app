/**
 * provision-operator — signup, server side.
 *
 * Route it as `provision-operator` in the `routes` map in ./index.ts.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS HANDLER EXISTS AT ALL
 *
 * `gocash.provision_operator(p_user_id, ...)` is granted to `service_role` and
 * to nothing else, on purpose. `p_user_id` is an argument, so a version of it
 * reachable with the anon key would let any signed-in user — or with `anon`, any
 * stranger — attach an operator, a chart of accounts and an opening balance to
 * somebody else's auth user. That is an account-takeover primitive, not a
 * cross-tenant write, and it is a strictly worse shape than the six
 * SECURITY DEFINER functions AUDITS.md #5/#5a found taking `p_operator_id` on
 * trust behind the public anon key.
 *
 * The whole job of this file is therefore to be the one place where a user id
 * stops being caller-supplied:
 *
 *   identity  comes from `auth.getUser()` on a client built from the caller's
 *             own Authorization header — the token is verified by GoTrue, so
 *             `user.id` is a fact, not a claim.
 *   authority comes from the service-role client, which is used for the RPC and
 *             for nothing that takes an id from the request.
 *
 * The request body never supplies an id. If it carries one that disagrees with
 * the verified token this returns 400 rather than quietly ignoring it: a client
 * sending a different id is either broken or probing, and both deserve to hear
 * about it. A body id that MATCHES the token is accepted and ignored, because
 * that is what `src/lib/ledger.ts`'s `ProvisionOperatorInput.userId` already
 * sends and it is harmless — it is checked, not trusted.
 * ---------------------------------------------------------------------------
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, jsonResponse } from "./_shared/cors.ts";

/**
 * Account names `provision_operator` creates unconditionally. A platform may
 * not be called one of these (the RPC raises on the collision with
 * `accounts_operator_id_name_key`), and an opening balance may not be given for
 * the revenue or equity account — equity is the derived balancing leg, and a
 * brand new operator cannot have earned a fee yet.
 */
const CASH_ACCOUNT = "Cash";
const DERIVED_ACCOUNTS = ["Fee Revenue", "Owner Equity"];
const RESERVED_ACCOUNTS = [CASH_ACCOUNT, ...DERIVED_ACCOUNTS];

/** Longest phone we will store. `operators.phone` is unconstrained TEXT. */
const MAX_PHONE_LENGTH = 32;

/** Matches `gocash.provision_operator`'s own argument names. */
interface ProvisionArgs {
  p_user_id: string;
  p_name: string;
  p_email: string;
  p_platforms: string[];
  p_opening: Record<string, number>;
}

interface Validated {
  name: string;
  email: string;
  phone: string | null;
  platforms: string[];
  opening: Record<string, number>;
}

/** A validation failure carrying the message the caller actually needs. */
class BadRequest extends Error {}

function fail(message: string): never {
  throw new BadRequest(message);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    fail(`${field} must be a string, got ${value === null ? "null" : typeof value}`);
  }
  return value.trim();
}

/**
 * The caller-supplied id check.
 *
 * Deliberately not a silent drop. `src/lib/ledger.ts` sends `userId`, and the
 * point of this endpoint is that the value is decorative — so prove it is
 * decorative by comparing it, and refuse when it is not.
 */
function assertNoForeignUserId(body: Record<string, unknown>, verifiedUserId: string) {
  for (const key of ["userId", "user_id", "p_user_id", "operator_id", "operatorId"]) {
    if (!(key in body) || body[key] === null || body[key] === undefined) continue;

    if (key === "operator_id" || key === "operatorId") {
      fail(
        `${key} is not accepted: provisioning creates the operator, so the caller ` +
          `cannot name one`
      );
    }
    if (body[key] !== verifiedUserId) {
      fail(
        `${key} in the request body does not match the authenticated user; the ` +
          `user id is taken from the access token and cannot be supplied by the caller`
      );
    }
  }
}

/**
 * Trim, drop blanks, de-duplicate — the same normalisation the RPC performs on
 * `p_platforms`, done here as well so the opening-balance keys can be checked
 * against the account names that will actually exist.
 */
function normalizePlatforms(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    fail(
      `platforms must be an array of platform names, e.g. ["GCash","MariBank","Maya"]`
    );
  }

  const seen = new Set<string>();
  const platforms: string[] = [];

  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== "string") {
      fail(`platforms[${index}] must be a string, got ${typeof entry}`);
    }
    const name = entry.trim();
    if (name === "") {
      fail(`platforms[${index}] is blank; every platform needs a name`);
    }
    if (RESERVED_ACCOUNTS.includes(name)) {
      fail(
        `platforms[${index}] is "${name}", which is reserved for the cash, revenue ` +
          `or equity account and cannot be used as a platform name`
      );
    }
    if (seen.has(name)) continue;
    seen.add(name);
    platforms.push(name);
  }

  if (platforms.length === 0) {
    fail(
      `platforms must contain at least one platform name; an operator with no ` +
        `platform account cannot record a transaction`
    );
  }

  return platforms;
}

/**
 * Opening balances, in CENTAVOS.
 *
 * Three checks the RPC does not fully make, each of which would otherwise land
 * as a 500 or as silently wrong money:
 *
 *   - integer      the RPC rejects a fractional value, but only once it is deep
 *                  inside the transaction. Catching it here returns the 100x
 *                  warning (`5000.50` means the caller sent pesos) as a 400.
 *   - non-negative the RPC ACCEPTS a negative opening balance and happily posts
 *                  it against equity. A signup form cannot mean "I start with
 *                  minus twenty thousand pesos in the drawer", so a negative
 *                  value is a bug in the caller, not an opening position.
 *   - safe integer JSON numbers past 2^53 have already lost precision by the
 *                  time we see them; `amount_minor` is BIGINT and would store
 *                  the wrong number without complaint.
 */
function normalizeOpening(raw: unknown, platforms: string[]): Record<string, number> {
  if (raw === undefined || raw === null) return {};

  if (typeof raw !== "object" || Array.isArray(raw)) {
    fail(
      `openingMinor must be an object of account name -> opening balance in ` +
        `CENTAVOS, e.g. {"Cash": 2000000}`
    );
  }

  const allowed = new Set<string>([CASH_ACCOUNT, ...platforms]);
  const opening: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (DERIVED_ACCOUNTS.includes(key)) {
      fail(
        `openingMinor cannot set "${key}"; equity is derived from the accounts ` +
          `that hold money, and revenue starts at zero for a new operator`
      );
    }
    if (!allowed.has(key)) {
      fail(
        `openingMinor names account "${key}", which will not exist for this ` +
          `operator; it must be "${CASH_ACCOUNT}" or one of the platforms ` +
          `[${platforms.join(", ")}]`
      );
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(
        `openingMinor["${key}"] must be a number of CENTAVOS, got ` +
          `${value === null ? "null" : typeof value}`
      );
    }
    if (!Number.isInteger(value)) {
      fail(
        `openingMinor["${key}"] is ${value}, which is not a whole number of ` +
          `CENTAVOS — opening balances are in centavos, not pesos ` +
          `(PHP 20,000.00 is 2000000)`
      );
    }
    if (!Number.isSafeInteger(value)) {
      fail(`openingMinor["${key}"] is too large to represent exactly in centavos`);
    }
    if (value < 0) {
      fail(
        `openingMinor["${key}"] is ${value}; an opening balance cannot be ` +
          `negative. Post a reconciliation entry if the books need correcting.`
      );
    }

    opening[key] = value;
  }

  return opening;
}

function validate(
  body: Record<string, unknown>,
  verifiedUserId: string,
  verifiedEmail: string | null
): Validated {
  assertNoForeignUserId(body, verifiedUserId);

  const name = readString(body.name, "name");
  if (name === "") fail("name is required");

  // The verified token's email wins. `operators.email` is UNIQUE, so accepting
  // a body-supplied address would let one user burn another's — a 23505 on
  // somebody else's row is a denial of service with extra steps. The body is
  // only consulted when the token carries no email at all (a phone-only or
  // anonymous sign-in), and then it is just a label on a row we are creating
  // for the verified id anyway.
  const bodyEmail = body.email === undefined || body.email === null
    ? ""
    : readString(body.email, "email");
  const email = verifiedEmail ?? bodyEmail;
  if (email === "") {
    fail(
      "email is required: the access token carries no email address, so one " +
        "must be supplied in the request body"
    );
  }

  let phone: string | null = null;
  if (body.phone !== undefined && body.phone !== null) {
    const trimmed = readString(body.phone, "phone");
    if (trimmed.length > MAX_PHONE_LENGTH) {
      fail(`phone must be at most ${MAX_PHONE_LENGTH} characters`);
    }
    phone = trimmed === "" ? null : trimmed;
  }

  const platforms = normalizePlatforms(body.platforms);
  const opening = normalizeOpening(
    body.openingMinor ?? body.opening_minor ?? body.opening,
    platforms
  );

  return { name, email, phone, platforms, opening };
}

export async function handleProvisionOperator(req: Request): Promise<Response> {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== "POST") {
    return jsonResponse(req, { error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse(req, { error: "Missing authorization" }, 401);

    // Identity only. This client holds the caller's own token and the anon key,
    // so it can do nothing the caller could not already do from the browser.
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        db: { schema: "gocash" },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) return jsonResponse(req, { error: "Unauthorized" }, 401);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return jsonResponse(req, { error: "Request body must be a JSON object" }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return jsonResponse(req, { error: "Request body must be valid JSON" }, 400);
    }

    let input: Validated;
    try {
      input = validate(body, user.id, user.email ?? null);
    } catch (err) {
      if (err instanceof BadRequest) {
        return jsonResponse(req, { error: err.message }, 400);
      }
      throw err;
    }

    // Authority. Used for the RPC and for reading back what it created — never
    // with an id that came from the request.
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        db: { schema: "gocash" },
      }
    );

    // -----------------------------------------------------------------------
    // ALREADY PROVISIONED -> 409, not 200.
    //
    // `provision_operator` returns the existing operator id rather than raising
    // (migration 20260924000005, step 3), and that behaviour is right for the
    // DATABASE: the whole thing is one transaction, so a client that retries
    // after losing the response must be able to arrive at the same operator
    // instead of a half-built one. Proven on a scratch database: a second call
    // with different platforms and a different opening balance returned the
    // same id, created nothing, and left the operator's six accounts untouched.
    //
    // At the HTTP boundary that same success is a lie of a different kind. A
    // 200 here would say "provisioned", while the platforms and the opening
    // balances the caller just sent were silently discarded — for signup that
    // means an operator who typed PHP 20,000 cash on hand, got a success screen,
    // and has no opening entry. Onboarding already routes an existing operator
    // straight to the dashboard before this is ever called, so reaching it with
    // an operator in place is a stale tab, a double submit, or a retry, and none
    // of those wants its balances treated as applied.
    //
    // So: 409, with `operator_id` and `already_provisioned` in the body. The
    // retry case is still served — the client has the id it needs to proceed and
    // can route to the dashboard on a 409 exactly as it would on a 200 — while a
    // caller whose opening balances were dropped is told so rather than
    // congratulated. The status carries the information; the body keeps the
    // recovery path.
    //
    // Read with the service-role client on purpose: the check is scoped to the
    // verified `user.id`, so it leaks nothing, and an RLS policy that hid the
    // caller's own row would otherwise send us into the RPC to collide with
    // `operators_user_id_idx` and surface as a 500.
    // -----------------------------------------------------------------------
    // A staff login belongs to someone else's shop. Letting it through here
    // would give it a second, separate set of books.
    const { data: staffOf } = await adminClient
      .from("operator_members")
      .select("operator_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (staffOf) {
      return jsonResponse(req, {
        error: "This login already has staff access to a shop.",
        code: "ALREADY_PROVISIONED",
        operator_id: staffOf.operator_id,
      }, 409);
    }

    const { data: existing, error: existingError } = await adminClient
      .from("operators")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existingError) {
      console.error("provision-operator: existing-operator lookup failed:", existingError.message);
      return jsonResponse(req, { error: "Failed to check for an existing operator" }, 500);
    }

    if (existing) {
      return jsonResponse(
        req,
        {
          error: "This account already has an operator; provisioning was not re-run",
          operator_id: existing.id,
          already_provisioned: true,
        },
        409
      );
    }

    const args: ProvisionArgs = {
      p_user_id: user.id, // <- the verified token subject. The only source.
      p_name: input.name,
      p_email: input.email,
      p_platforms: input.platforms,
      p_opening: input.opening,
    };

    const { data: rpcData, error: rpcError } = await adminClient.rpc(
      "provision_operator",
      args
    );

    if (rpcError) {
      // 42501 is `provision_operator`'s own service-role guard firing. Reaching
      // it means this handler called the RPC with something other than the
      // service-role key — a misconfigured SUPABASE_SERVICE_ROLE_KEY, or an
      // edit that swapped the clients over. The caller did nothing wrong and
      // cannot fix it, so it is a 500 and it is logged loudly. Returning 400
      // here would point the blame at the client and hide a deployment fault
      // behind a validation error.
      if (rpcError.code === "42501") {
        console.error(
          "provision-operator: BUG — provision_operator refused the service-role " +
            "guard. The RPC was not called with the service-role key. Check " +
            "SUPABASE_SERVICE_ROLE_KEY.",
          rpcError.message
        );
        return jsonResponse(req, { error: "Server misconfiguration" }, 500);
      }

      // Lost a race with a concurrent signup for the same user (unique index
      // `operators_user_id_idx`), or the email is already on another operator
      // (`operators_email_key`). Both are conflicts, not bad requests.
      if (rpcError.code === "23505") {
        const onEmail = (rpcError.message ?? "").includes("operators_email_key");
        return jsonResponse(
          req,
          {
            error: onEmail
              ? "That email address already belongs to another operator"
              : "This account already has an operator; provisioning was not re-run",
            already_provisioned: !onEmail,
          },
          409
        );
      }

      // P0001 — a bare RAISE EXCEPTION from the RPC's own argument checks. The
      // messages are written for the caller (they name the argument and the
      // unit) and carry nothing sensitive, so they are passed through. Anything
      // this handler can validate is validated above; reaching here means the
      // RPC knows something we do not, which is exactly when its wording helps.
      if (rpcError.code === "P0001") {
        return jsonResponse(req, { error: rpcError.message }, 400);
      }

      console.error("provision-operator: provision_operator failed:", rpcError);
      return jsonResponse(req, { error: "Failed to provision operator" }, 500);
    }

    const operatorId = typeof rpcData === "string" ? rpcData : null;
    if (!operatorId) {
      console.error("provision-operator: RPC returned no operator id:", rpcData);
      return jsonResponse(req, { error: "Failed to provision operator" }, 500);
    }

    // -----------------------------------------------------------------------
    // PHONE.
    //
    // `gocash.provision_operator` has NO p_phone argument — its signature is
    // (p_user_id, p_name, p_email, p_platforms, p_opening) — while
    // `gocash.operators.phone` exists (baseline schema) and the onboarding form
    // collects it. So the column has to be written here, in a second statement,
    // outside the provisioning transaction.
    //
    // That makes it best-effort by construction: the operator, the chart of
    // accounts and the opening entry are already committed by the time this
    // runs, and there is nothing to roll back to. Failing the whole request over
    // an optional phone number would report a signup as failed after it
    // succeeded, and the retry would then hit the 409 above. So the failure is
    // logged and reported in the response, and the signup stands.
    //
    // The real fix is an argument on the RPC (see the note on
    // `ProvisionOperatorInput.phone` in src/lib/ledger.ts); until then this
    // window exists and is stated rather than hidden.
    // -----------------------------------------------------------------------
    let phoneSaved = input.phone === null;
    if (input.phone !== null) {
      const { error: phoneError } = await adminClient
        .from("operators")
        .update({ phone: input.phone })
        .eq("id", operatorId);

      if (phoneError) {
        console.error(
          "provision-operator: operator provisioned but phone not saved:",
          phoneError.message
        );
      } else {
        phoneSaved = true;
      }
    }

    // What the RPC actually built, read back rather than assumed — the client
    // needs the account ids to render balances, and reading them proves the
    // transaction committed rather than trusting the return value alone.
    const { data: accounts, error: accountsError } = await adminClient
      .from("accounts")
      .select("id, kind, name")
      .eq("operator_id", operatorId)
      .order("kind")
      .order("name");

    if (accountsError) {
      console.error(
        "provision-operator: provisioned but could not read back accounts:",
        accountsError.message
      );
    }

    const { data: openingEntry } = await adminClient
      .from("ledger_entries")
      .select("id")
      .eq("operator_id", operatorId)
      .eq("kind", "opening")
      .maybeSingle();

    return jsonResponse(
      req,
      {
        operator_id: operatorId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        // False only when a phone was supplied and the follow-up write failed.
        // The signup itself still succeeded; the number can be set in Settings.
        phone_saved: phoneSaved,
        platforms: input.platforms,
        accounts: accounts ?? [],
        // Null is the normal case: signing up with every balance at zero posts
        // no entry at all, because an entry with no legs commits silently and
        // then sits in gocash.unbalanced_entries forever.
        opening_entry_id: openingEntry ? openingEntry.id : null,
      },
      201
    );
  } catch (err) {
    console.error("Unhandled error in provision-operator:", err);
    return jsonResponse(req, { error: "Internal server error" }, 500);
  }
}
