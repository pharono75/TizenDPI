# Source and runtime notes

TizenBrew's module documentation lists appName, packageType, appPath, keys and
serviceFile for app modules. Its module loader retrieves package.json and maps
appPath to a URL under 127.0.0.1:8081. serviceLauncher retrieves serviceFile
from jsDelivr, creates a VM context with require and Tizen globals, and executes
the source with vm.runInContext. It does not call an exported module startup
method. TizenDPI starts its diagnostic server at top-level and has no local
relative imports, so the exact serviceFile can be evaluated alone.

TizenBrew's root service declares a Tizen web service in its config.xml. That
is distinct from a module serviceFile. The latter runs inside the already
running TizenBrew Node service context; it is not a separate OS process.

Node 4.4.3 compatibility was statically audited: ES5 syntax only and built-ins
http, net, dns and https. There are no dependencies, promises, fetch,
async/await, arrow functions, optional chaining, Buffer.alloc/from, or newer
object helpers in service/index.js. The local machine has Node v24; no Node 4
binary or TV shell is available for executing this code under v4.

Samsung's web engine matrix lists Tizen 3.0 (2017) as Chromium M47 and reports
CORS and CSP Level 1 support for that generation. The UI uses an external script
and style, avoids inline script/eval and credentials, and allows its API origin
in a CSP meta policy. The service returns wildcard ACAO for a simple GET.
Samsung's security FAQ also documents restrictions around Origin headers; the
browser's automatic cross-origin behavior on this TV/module origin is therefore
not treated as proven. The UI itself is the end-to-end device check.

Publication cannot be verified until a public GitHub owner/repository exists.
The exact jsDelivr paths and required manual checks are in README.md. No
repository creation, push, release, TV installation, SDB connection, firmware
action, or TizenBrew/TizenTube modification is part of this change.
