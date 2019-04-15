import { postgraphile, makePluginHook } from "postgraphile";
import { NodePlugin } from "graphile-build";
import { Application, Request, Response } from "express";
import PgPubsub from "@graphile/pg-pubsub";
import PgSimplifyInflectorPlugin from "@graphile-contrib/pg-simplify-inflector";
import PassportLoginPlugin from "../plugins/PassportLoginPlugin";
import PrimaryKeyMutationsOnlyPlugin from "../plugins/PrimaryKeyMutationsOnlyPlugin";

type UUID = string;

function uuidOrNull(input: string | number | null): UUID | null {
  if (!input) return null;
  const str = String(input);
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      str
    )
  ) {
    return str;
  } else {
    return null;
  }
}

const isDev = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";
const pluginHook = makePluginHook([PgPubsub]);

export default function installPostGraphile(app: Application) {
  app.use(
    postgraphile<Request, Response>(
      process.env.AUTH_DATABASE_URL,
      "app_public",
      {
        // This is for PostGraphile server plugins: https://www.graphile.org/postgraphile/plugins/
        pluginHook,

        // This is so that PostGraphile installs the watch fixtures, it's also needed to enable live queries
        ownerConnectionString: process.env.DATABASE_URL,

        // Add websocket support to the PostGraphile server; you still need to use a subscriptions plugin such as
        // @graphile/pg-pubsub
        subscriptions: true,

        // enableQueryBatching: On the client side, use something like apollo-link-batch-http to make use of this
        enableQueryBatching: true,

        // dynamicJson: instead of inputting/outputting JSON as strings, input/output raw JSON objects
        dynamicJson: true,

        // ignoreRBAC=false: honour the permissions in your DB - don't expose what you don't GRANT
        ignoreRBAC: false,

        // ignoreIndexes=false: honour your DB indexes - only expose things that are fast
        ignoreIndexes: false,

        // setofFunctionsContainNulls=false: reduces the number of nulls in your schema
        setofFunctionsContainNulls: false,

        // Enable GraphiQL in development
        graphiql: isDev,
        // Use a fancier GraphiQL with `prettier` for formatting, and header editing.
        enhanceGraphiql: true,

        // Disable query logging - we're using morgan
        disableQueryLog: true,

        // See https://www.graphile.org/postgraphile/debugging/
        extendedErrors:
          isDev || isTest
            ? [
                "errcode",
                "severity",
                "detail",
                "hint",
                "positon",
                "internalPosition",
                "internalQuery",
                "where",
                "schema",
                "table",
                "column",
                "dataType",
                "constraint",
                "file",
                "line",
                "routine",
              ]
            : ["errcode"],
        showErrorStack: isDev,

        // Automatically update GraphQL schema when database changes
        watchPg: isDev,

        // Keep data/schema.graphql and data/schema.json up to date
        exportGqlSchemaPath: isDev
          ? `${__dirname}/../../../../data/schema.graphql`
          : undefined,
        exportJsonSchemaPath: isDev
          ? `${__dirname}/../../../../data/schema.json`
          : undefined,

        /*
         * Plugins to enhance the GraphQL schema, see:
         *   https://www.graphile.org/postgraphile/extending/
         */
        appendPlugins: [
          // Simplifies the field names generated by PostGraphile.
          PgSimplifyInflectorPlugin,

          // Omits by default non-primary-key constraint mutations
          PrimaryKeyMutationsOnlyPlugin,

          // Adds the `login` mutation to enable users to log in
          PassportLoginPlugin,
        ],

        /*
         * Plugins we don't want in our schema
         */
        skipPlugins: [
          // Disable the 'Node' interface
          NodePlugin,
        ],

        graphileBuildOptions: {
          /*
           * Any properties here are merged into the settings passed to each Graphile
           * Engine plugin - useful for configuring how the plugins operate.
           */
        },

        /*
         * Postgres transaction settings for each GraphQL query/mutation to
         * indicate to Postgres who is attempting to access the resources. These
         * will be referenced by RLS policies/triggers/etc.
         *
         * Settings set here will be set using the equivalent of `SET LOCAL`, so
         * certain things are not allowed. You can override Postgres settings such
         * as 'role' and 'search_path' here; but for settings indicating the
         * current user, session id, or other privileges to be used by RLS policies
         * the setting names must contain at least one and at most two period
         * symbols (`.`), and the first segment must not clash with any Postgres or
         * extension settings. We find `jwt.claims.*` to be a safe namespace,
         * whether or not you're using JWTs.
         */
        async pgSettings(req) {
          return {
            // Everyone uses the "visitor" role currently
            role: process.env.DATABASE_VISITOR,

            /*
             * Note, though this says "jwt" it's not actually anything to do with
             * JWTs, we just know it's a safe namespace to use, and it means you
             * can use JWTs too, if you like, and they'll use the same settings
             * names reducing the amount of code you need to write.
             */
            "jwt.claims.session_id":
              req.user && uuidOrNull(req.user.session_id),
          };
        },

        /*
         * These properties are merged into context (the third argument to GraphQL
         * resolvers). This is useful if you write your own plugins that need
         * access to, e.g., the logged in user.
         */
        async additionalGraphQLContextFromRequest(req) {
          return {
            // Needed so passport can write to the database
            rootPgPool: app.get("rootPgPool"),

            // Use this to tell Passport.js we're logged in
            login: (user: any) =>
              new Promise((resolve, reject) => {
                req.login(user, err => (err ? reject(err) : resolve()));
              }),

            logout: () => {
              req.logout();
              return Promise.resolve();
            },
          };
        },

        /*
      // Pro plugin options (requires GRAPHILE_LICENSE)

      defaultPaginationCap:
        parseInt(process.env.GRAPHQL_PAGINATION_CAP || "", 10) || 50,
      graphqlDepthLimit:
        parseInt(process.env.GRAPHQL_DEPTH_LIMIT || "", 10) || 12,
      graphqlCostLimit:
        parseInt(process.env.GRAPHQL_COST_LIMIT || "", 10) || 30000,
      exposeGraphQLCost:
        (parseInt(process.env.HIDE_QUERY_COST || "", 10) || 0) < 1,
      // readReplicaPgPool ...,

      */
      }
    )
  );
}
