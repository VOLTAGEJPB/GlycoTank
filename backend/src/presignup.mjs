// Cognito pre-sign-up trigger: keeps one account per email address.
//
// When someone signs in with Google or Apple for the first time, Cognito would
// normally create a separate user. Instead we link that login to the email
// account with the same address (creating one if needed), so email, Google and
// Apple sign-in all open the same data. Google and Apple only hand over
// addresses they have verified.
//
// Cognito then rejects that first sign-in ("Already found an entry for
// username"); the app retries once and it succeeds as the linked account.

import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminConfirmSignUpCommand,
  AdminUpdateUserAttributesCommand,
  AdminLinkProviderForUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { randomBytes } from "node:crypto";

const idp = new CognitoIdentityProviderClient({});
const PROVIDERS = { google: "Google", signinwithapple: "SignInWithApple" };

export async function handler(event) {
  if (event.triggerSource !== "PreSignUp_ExternalProvider") return event;

  const email = String(event.request.userAttributes.email || "").toLowerCase();
  const [prefix, ...rest] = event.userName.split("_");
  const providerName = PROVIDERS[prefix.toLowerCase()];
  if (!email || !providerName) return event; // nothing to link on; let Cognito create the user

  const UserPoolId = event.userPoolId;
  const { Users = [] } = await idp.send(new ListUsersCommand({ UserPoolId, Filter: `email = "${email.replace(/"/g, "")}"`, Limit: 10 }));
  let account = Users.find((u) => u.UserStatus !== "EXTERNAL_PROVIDER");

  if (!account) {
    // First visit with this address: create the email account to link to. It
    // gets a random password; the user can set one with "Forgot password".
    const created = await idp.send(
      new AdminCreateUserCommand({
        UserPoolId,
        Username: email,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
    account = created.User;
    await idp.send(new AdminSetUserPasswordCommand({ UserPoolId, Username: account.Username, Password: `Aa1-${randomBytes(24).toString("base64url")}`, Permanent: true }));
  } else {
    // Signed up with email but never entered the code: the provider has
    // verified the address, so finish that sign-up.
    if (account.UserStatus === "UNCONFIRMED") await idp.send(new AdminConfirmSignUpCommand({ UserPoolId, Username: account.Username }));
    await idp.send(new AdminUpdateUserAttributesCommand({ UserPoolId, Username: account.Username, UserAttributes: [{ Name: "email_verified", Value: "true" }] }));
  }

  await idp.send(
    new AdminLinkProviderForUserCommand({
      UserPoolId,
      DestinationUser: { ProviderName: "Cognito", ProviderAttributeValue: account.Username },
      SourceUser: { ProviderName: providerName, ProviderAttributeName: "Cognito_Subject", ProviderAttributeValue: rest.join("_") },
    }),
  );
  return event;
}
