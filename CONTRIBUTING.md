This repository is an attempt to create a functional Discord modification using *bytecode-based*
patches. If you're familiar with Vencord, the concept is similar, except things are a bit more
involved since the source code being patched is not in text form.

If that interests you, here I will try to explain Hermes bytecode by translating existing patches
for the web version (from Vencord).

A simple yet useful patch is from the Experiments plugin:

```js
{
    find: "Object.defineProperties(this,{isDeveloper",
    replacement: {
        match: /(?<={isDeveloper:\{[^}]+?,get:\(\)=>)\i/,
        replace: "true"
    }
}
```

This patch targets the following function, making the getter for `isDeveloper` simply return `true`:

```js
initialize() {
    this.waitFor(l.default, s.Z),
    Object.defineProperties(this, {
        isDeveloper: {
            configurable: !1,
            get: () => f,
            set: () => {}
        }
    }),
    _(),
    setTimeout(() => Object.freeze(this))
}
```

On the Hermes bundle, we can find the exact same code (since non-UI code is conveniently shared
between both versions). There is no exact assembly form, but our inspector would show you something
like this:

```js
#76145 value:
// ... snip
GetGlobalObject r2
TryGetById r5, r2, 2, "Object"
GetById r4, r5, 3, "defineProperties"
NewObject r3
NewObject r7
LoadConstFalse r8
PutNewOwnById r7, r8, "configurable"
CreateClosure r8, r1, #76146
PutNewOwnById r7, r8, "get"
CreateClosure r8, r1, #76147
PutNewOwnById r7, r8, "set"
PutNewOwnById r3, r7, "isDeveloper"
Call3 r3, r4, r5, r6, r3
// ... snip

#76146 get:
GetEnvironment r0, 2
LoadFromEnvironment r0, r0, 10
Ret r0

#76147 set:
LoadConstUndefined r0
Ret r0
```

A translation of the web version of the patch could:

1. match the function by its "fingerprint"
2. locate the `CreateClosure` opcode with the `get` function
3. replace the bytecode of that function to simply `return true`

The current API allows us to write exactly that:

```js
{
    strings: ["Object", "defineProperties", "isDeveloper"], // [1] fingerprint by constituent strings

    apply(f) {
        const [createClosure] = f.match(                    // [2] find our `CreateClosure`
            [Opcode.CreateClosure, null, null, null],
            [Opcode.PutNewOwnById, null, null, "get"],
        )

        f.getClosure(createClosure).replace([               // [3] replace with `return true`
            [Opcode.LoadConstTrue, 0],
            [Opcode.Ret, 0],
        ])
    },
}
```

Fingerprints are, conceptually, anything about the function which is unlikely to change by small
refactors (and thus app updates). That can be the function's own name (`identifier`), strings that
it uses (`strings`) or rarer opcodes that it references (`opcodes`).

The API lets you take this a step further, and declare *sub-patches* with their own fingerprints.
Instead of trying to match every function, it will only match functions inside
`CreateClosure`-family opcodes, just like we did above:

```js
{
    strings: ["Object", "defineProperties", "isDeveloper"], // [1]
    patch: {
        identifier: "get",                                  // [2]

        replace: [                                          // [3] we don't need `apply` this time!
            [Opcode.LoadConstTrue, 0],
            [Opcode.Ret, 0],
        ],
    },
}
```

That's a lot of explaining for a simple patch, but the same concepts apply to more complex patches!
