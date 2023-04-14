# SCIM provisioning

Zulip has beta support for user provisioning and deprovisioning via
the SCIM protocol. In SCIM, a third-party SCIM Identity Provider (IdP)
acts as the SCIM client, connecting to the service provider (your Zulip
server).

See the [SCIM help center page](https://zulip.com/help/scim) for
documentation on SCIM in [Zulip Cloud](https://zulip.com) as well as
detailed documentation for how to configure some SCIM IdP providers.

Synchronizing groups via SCIM is currently not supported.

## Server configuration

The Zulip server-side configuration is straightforward:

1. Pick a client name for your SCIM client. This name is internal to
   your Zulip configuration, so the name of your IdP provider is a
   good choice. We'll use `okta` in the examples below.
1. First a SCIM client entry needs to be added to the database. Run
   `manage.py add_scim_client <client name> -r <subdomain>`. For
   example, if your organization is hosted on a subdomain
   (`subdomain.zulip.example.com`):

   ```
   /home/zulip/deployments/current/manage.py add_scim_client okta -r 'subdomain'
   ```

   Or your organization is hosted on the root domain (`zulip.example.com`):

   ```
   /home/zulip/deployments/current/manage.py add_scim_client okta -r ""
   ```

   See the [management command documentation](./management-commands.md)
   for details on how to run management commands.

1. Configure the Zulip server by adding a `SCIM_CONFIG` block to your
   `/etc/zulip/settings.py`:

   ```
   SCIM_CONFIG = {
        "subdomain": {
            "bearer_token": "<secret token>",
            "scim_client_name": "okta",
            "name_formatted_included": False,
        }
    }
   ```

   The `bearer_token` should contain a secure, secret token that you
   generate. You can use any secure password generation tools for this,
   such as the `apg` command included by default in some Linux distributions.
   For example, `apg -m20` will generate some passwords of minimum length 20
   for you.

   The SCIM IdP will authenticate its requests to your Zulip server by
   sending a `WWW-Authenticate` header like this:
   `WWW-Authenticate: Bearer <secret token>`. `name_formatted_included` needs to be set
   to `False` for Okta. It tells Zulip whether the IdP includes
   `name.formatted` in its `User` representation.

1. Now you can proceed to [configuring your SCIM IdP](https://zulip.com/help/scim).
   Use the value `Bearer <secret token>` using the `bearer_token` you've generated
   earlier as the `API token` that the SCIM IdP will ask for when configuring
   authentication details.
