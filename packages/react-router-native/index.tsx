import * as React from "react";
import {
  BackHandler,
  GestureResponderEvent,
  Linking,
  TouchableHighlight,
  TouchableHighlightProps,
} from "react-native";
import {
  MemoryRouter,
  MemoryRouterProps,
  NavigateOptions,
  UNSAFE_reactRouterContexts,
  UNSAFE_createReactRouterContexts,
  UNSAFE_createReactRouterEnvironment,
  createScopedMemoryRouterEnvironment as baseCreateScopedMemoryRouterEnvironment,
} from "react-router";
import type { To, Hooks } from "react-router";

import URLSearchParams from "@ungap/url-search-params";

////////////////////////////////////////////////////////////////////////////////
// RE-EXPORTS
////////////////////////////////////////////////////////////////////////////////

// Note: Keep in sync with react-router exports!
export type {
  ActionFunction,
  ActionFunctionArgs,
  DataMemoryRouterProps,
  DataRouteMatch,
  DeferredProps,
  Fetcher,
  Hash,
  IndexRouteProps,
  JsonFunction,
  LayoutRouteProps,
  LoaderFunction,
  LoaderFunctionArgs,
  Location,
  MemoryRouterProps,
  NavigateFunction,
  NavigateOptions,
  NavigateProps,
  Navigation,
  Navigator,
  OutletProps,
  Params,
  ParamParseKey,
  Path,
  PathMatch,
  Pathname,
  PathPattern,
  PathRouteProps,
  RedirectFunction,
  RouteMatch,
  RouteObject,
  RouteProps,
  RouterProps,
  RoutesProps,
  Search,
  ShouldRevalidateFunction,
  To,
} from "react-router";
export {
  DataMemoryRouter,
  Deferred,
  MemoryRouter,
  Navigate,
  NavigationType,
  Outlet,
  Route,
  Router,
  Routes,
  createPath,
  createRoutesFromChildren,
  deferred,
  isDeferredError,
  isRouteErrorResponse,
  generatePath,
  json,
  matchPath,
  matchRoutes,
  parsePath,
  redirect,
  renderMatches,
  resolvePath,
  useActionData,
  useDeferredData,
  useHref,
  useInRouterContext,
  useLoaderData,
  useLocation,
  useMatch,
  useMatches,
  useNavigate,
  useNavigation,
  useNavigationType,
  useOutlet,
  useOutletContext,
  useParams,
  useResolvedPath,
  useRevalidator,
  useRouteError,
  useRouteLoaderData,
  useRoutes,
} from "react-router";

///////////////////////////////////////////////////////////////////////////////
// DANGER! PLEASE READ ME!
// We provide these exports as an escape hatch in the event that you need any
// routing data that we don't provide an explicit API for. With that said, we
// want to cover your use case if we can, so if you feel the need to use these
// we want to hear from you. Let us know what you're building and we'll do our
// best to make sure we can support you!
//
// We consider these exports an implementation detail and do not guarantee
// against any breaking changes, regardless of the semver release. Use with
// extreme caution and only if you understand the consequences. Godspeed.
///////////////////////////////////////////////////////////////////////////////

/** @internal */
export {
  UNSAFE_DataRouter,
  UNSAFE_DataRouterProvider,
  UNSAFE_DataRouterContext,
  UNSAFE_DataRouterStateContext,
  UNSAFE_DataStaticRouterContext,
  UNSAFE_NavigationContext,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
  UNSAFE_createReactRouterContexts,
  UNSAFE_createReactRouterEnvironment,
  UNSAFE_reactRouterContexts,
} from "react-router";

////////////////////////////////////////////////////////////////////////////////
// COMPONENTS
////////////////////////////////////////////////////////////////////////////////

export interface NativeRouterProps extends MemoryRouterProps {}

/**
 * A <Router> that runs on React Native.
 */
export function NativeRouter(props: NativeRouterProps) {
  return <MemoryRouter {...props} />;
}

export interface LinkProps extends TouchableHighlightProps {
  children?: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  replace?: boolean;
  state?: any;
  to: To;
}

function createLink(
  useLinkPressHandler: ReturnType<typeof createLinkPressHandlerHook>
) {
  return function Link({
    onPress,
    replace = false,
    state,
    to,
    ...rest
  }: LinkProps) {
    let internalOnPress = useLinkPressHandler(to, { replace, state });
    function handlePress(event: GestureResponderEvent) {
      if (onPress) onPress(event);
      if (!event.defaultPrevented) {
        internalOnPress(event);
      }
    }

    return <TouchableHighlight {...rest} onPress={handlePress} />;
  };
}

////////////////////////////////////////////////////////////////////////////////
// HOOKS
////////////////////////////////////////////////////////////////////////////////

const HardwareBackPressEventType = "hardwareBackPress";
const URLEventType = "url";

function createLinkPressHandlerHook({ useNavigate }: Hooks) {
  return function useLinkPressHandler(
    to: To,
    {
      replace,
      state,
    }: {
      replace?: boolean;
      state?: any;
    } = {}
  ): (event: GestureResponderEvent) => void {
    let navigate = useNavigate();
    return function handlePress() {
      navigate(to, { replace, state });
    };
  };
}

function createHardwareBackButtonHook() {
  return function useHardwareBackButton() {
    React.useEffect(() => {
      function handleHardwardBackPress() {
        return undefined;
        // TODO: The implementation will be something like this
        // if (history.index === 0) {
        //   return false; // home screen
        // } else {
        //   history.back();
        //   return true;
        // }
      }

      BackHandler.addEventListener(
        HardwareBackPressEventType,
        handleHardwardBackPress
      );

      return () => {
        BackHandler.removeEventListener(
          HardwareBackPressEventType,
          handleHardwardBackPress
        );
      };
    }, []);
  };
}

function createDeepLinkingHook({ useNavigate }: Hooks) {
  return function useDeepLinking() {
    let navigate = useNavigate();

    // Get the initial URL
    React.useEffect(() => {
      let current = true;

      Linking.getInitialURL().then((url) => {
        if (current) {
          if (url) navigate(trimScheme(url));
        }
      });

      return () => {
        current = false;
      };
    }, [navigate]);

    // Listen for URL changes
    React.useEffect(() => {
      function handleURLChange(event: { url: string }) {
        navigate(trimScheme(event.url));
      }

      Linking.addEventListener(URLEventType, handleURLChange);

      return () => {
        Linking.removeEventListener(URLEventType, handleURLChange);
      };
    }, [navigate]);
  };
}

function trimScheme(url: string) {
  return url.replace(/^.*?:\/\//, "");
}

function createSearchParamsHook({ useNavigate, useLocation }: Hooks) {
  return function useSearchParams(
    defaultInit?: URLSearchParamsInit
  ): [URLSearchParams, SetURLSearchParams] {
    let defaultSearchParamsRef = React.useRef(createSearchParams(defaultInit));

    let location = useLocation();
    let searchParams = React.useMemo(() => {
      let searchParams = createSearchParams(location.search);

      for (let key of defaultSearchParamsRef.current.keys()) {
        if (!searchParams.has(key)) {
          defaultSearchParamsRef.current.getAll(key).forEach((value) => {
            searchParams.append(key, value);
          });
        }
      }

      return searchParams;
    }, [location.search]);

    let navigate = useNavigate();
    let setSearchParams = React.useCallback<SetURLSearchParams>(
      (nextInit, navigateOpts) => {
        const newSearchParams = createSearchParams(
          typeof nextInit === "function" ? nextInit(searchParams) : nextInit
        );
        navigate("?" + newSearchParams, navigateOpts);
      },
      [navigate, searchParams]
    );

    return [searchParams, setSearchParams];
  };
}

type SetURLSearchParams = (
  nextInit?:
    | URLSearchParamsInit
    | ((prev: URLSearchParams) => URLSearchParamsInit),
  navigateOpts?: NavigateOptions
) => void;

export type ParamKeyValuePair = [string, string];

export type URLSearchParamsInit =
  | string
  | ParamKeyValuePair[]
  | Record<string, string | string[]>
  | URLSearchParams;

/**
 * Creates a URLSearchParams object using the given initializer.
 *
 * This is identical to `new URLSearchParams(init)` except it also
 * supports arrays as values in the object form of the initializer
 * instead of just strings. This is convenient when you need multiple
 * values for a given key, but don't want to use an array initializer.
 *
 * For example, instead of:
 *
 *   let searchParams = new URLSearchParams([
 *     ['sort', 'name'],
 *     ['sort', 'price']
 *   ]);
 *
 * you can do:
 *
 *   let searchParams = createSearchParams({
 *     sort: ['name', 'price']
 *   });
 */
export function createSearchParams(
  init: URLSearchParamsInit = ""
): URLSearchParams {
  return new URLSearchParams(
    typeof init === "string" ||
    Array.isArray(init) ||
    init instanceof URLSearchParams
      ? init
      : Object.keys(init).reduce((memo, key) => {
          let value = init[key];
          return memo.concat(
            Array.isArray(value) ? value.map((v) => [key, v]) : [[key, value]]
          );
        }, [] as ParamKeyValuePair[])
  );
}

function createReactRouterNativeEnvironment(
  contexts = UNSAFE_reactRouterContexts
) {
  const { hooks } = UNSAFE_createReactRouterEnvironment(contexts);
  const useLinkPressHandler = createLinkPressHandlerHook(hooks);
  const useAndroidBackButton = createHardwareBackButtonHook();
  const useDeepLinking = createDeepLinkingHook(hooks);
  const useSearchParams = createSearchParamsHook(hooks);

  const Link = createLink(useLinkPressHandler);

  return {
    hooks: {
      /**
       * Handles the press behavior for router `<Link>` components. This is useful if
       * you need to create custom `<Link>` components with the same press behavior we
       * use in our exported `<Link>`.
       */
      useLinkPressHandler,

      /**
       * Enables support for the hardware back button on Android.
       */
      useAndroidBackButton,

      /**
       * Enables deep linking, both on the initial app launch and for
       * subsequent incoming links.
       */
      useDeepLinking,

      /**
       * A convenient wrapper for accessing individual query parameters via the
       * URLSearchParams interface.
       */
      useSearchParams,
    },
    components: {
      /**
       * A <TouchableHighlight> that navigates to a different URL when touched.
       */
      Link,
    },
  };
}

const {
  hooks: {
    useLinkPressHandler,
    useAndroidBackButton,
    useDeepLinking,
    useSearchParams,
  },
  components: { Link },
} = createReactRouterNativeEnvironment();

export {
  useLinkPressHandler,
  useAndroidBackButton,
  useDeepLinking,
  useSearchParams,
  Link,
};

export function createScopedMemoryRouterEnvironment() {
  const contexts = UNSAFE_createReactRouterContexts();
  const reactRouterEnvironment =
    baseCreateScopedMemoryRouterEnvironment(contexts);
  const reactRouterDomEnvironment =
    createReactRouterNativeEnvironment(contexts);

  return {
    ...reactRouterEnvironment,
    ...reactRouterDomEnvironment.hooks,
    ...reactRouterDomEnvironment.components,
  };
}
