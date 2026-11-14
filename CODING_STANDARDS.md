# Coding standards

## Fail with a thrown response, not a return value

A loader or an action that cannot continue throws. It does not return an
error shape for the component to unpack.

```ts
if (!course) throw data("Course not found", { status: 404 });
```

The route then has one success path. A returned error shape gives every
component a second path to forget about.

## Parse untrusted input with a schema

Form data, search parameters and request bodies get a zod schema before the
values reach any query. Do not read `formData.get("x") as string`. The cast
is a lie the type checker believes.

## Do not write `any`, and do not write `!`

Both switch the type checker off at the exact point you are least sure. If a
value can be missing, narrow it with a check. If you cannot name the type,
the shape is wrong — fix the shape.

## Keep `~/db` out of the client bundle

Reach the database only from loader and action code, or from `*.server.ts`
modules. Any module that imports `~/db` stays free of module-scope side
effects: one side effect stops Rollup from dropping the import from the
client bundle, and `better-sqlite3` ends up in the browser. `app/db/index.ts`
explains how it stays side-effect free.
