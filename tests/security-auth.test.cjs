const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.KKPermissions =
  require("../security-permissions.js");

const secureAuth = require("../security-auth.js");

function mockClient(options = {}) {
  let signedOut = false;

  const client = {
    auth: {
      async signInWithPassword() {
        return { error: options.badPassword
          ? new Error("Invalid password") : null };
      },
      async getUser() {
        return {
          data: { user: options.noUser
            ? null : { id: "auth-123" } },
          error: null
        };
      },
      async signOut() {
        signedOut = true;
        return { error: null };
      }
    },
    from(table) {
      assert.equal(table, "kk_staff_access");
      return {
        select() {
          return {
            eq(column, value) {
              assert.equal(column, "auth_user_id");
              assert.equal(value, "auth-123");
              return {
                async maybeSingle() {
                  return {
                    data: options.profile ?? null,
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  return { client, wasSignedOut: () => signedOut };
}

const validProfile = {
  auth_user_id: "auth-123",
  login_id: "staff01",
  display_name: "Sales Staff",
  employee_id: "KS-005",
  role: "employee",
  stores: ["Main Branch"],
  features: ["dashboard"],
  active: true
};

test("valid Auth identity loads authorized staff", async () => {
  const { client } = mockClient({ profile: validProfile });
  const result = await secureAuth.login(
    client, "staff@example.com", "example-password"
  );

  assert.equal(result.valid, true);
  assert.equal(result.user, "staff01");
  assert.deepEqual(result.features, ["dashboard"]);
});

test("invalid password rejects login", async () => {
  const { client } = mockClient({ badPassword: true });
  await assert.rejects(
    secureAuth.login(client, "staff@example.com", "wrong"),
    /Invalid credentials/
  );
});

test("missing staff profile rejects and signs out", async () => {
  const mock = mockClient();
  await assert.rejects(
    secureAuth.login(mock.client, "staff@example.com", "example"),
    /not authorized/
  );
  assert.equal(mock.wasSignedOut(), true);
});

test("inactive account is rejected", async () => {
  const mock = mockClient({
    profile: { ...validProfile, active: false }
  });
  assert.equal(await secureAuth.getStaff(mock.client), null);
});

test("mismatched Auth user cannot use staff profile", async () => {
  const mock = mockClient({
    profile: { ...validProfile, auth_user_id: "other-user" }
  });
  assert.equal(await secureAuth.getStaff(mock.client), null);
});
