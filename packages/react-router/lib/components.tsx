import * as React from "react";
import type {
  HydrationState,
  InitialEntry,
  Location,
  MemoryHistory,
  RouteMatch,
  RouteObject,
  Router as RemixRouter,
  RouterState,
  To,
} from "@remix-run/router";
import {
  Action as NavigationType,
  createMemoryHistory,
  createMemoryRouter,
  invariant,
  isDeferredError,
  parsePath,
  stripBasename,
  warning,
} from "@remix-run/router";
import { useSyncExternalStore as useSyncExternalStoreShim } from "./use-sync-external-store-shim";

import {
  Navigator,
  DataRouterContextObject,
  createLocationContext,
  createNavigationContext,
  createDataRouterContext,
  createRouteContext,
  createDataRouterStateContext,
  RouterContext,
} from "./context";
import {
  LocationContext as DefaultLocationContext,
  NavigationContext as DefaultNavigationContext,
  DataRouterContext as DefaultDataRouterContext,
  RouteContext as DefaultRouteContext,
  DataRouterStateContext as DefaultDataRouterStateContext,
  DeferredContext,
} from "./context";
import {
  createHrefHook,
  createLocationHook,
  createMatchHook,
  createNavigateHook,
  createNavigationTypeHook,
  createOutletHook,
  createParamsHook,
  createResolvedPathHook,
  createRoutesHook,
  useDeferredData,
  useInRouterContext,
  useOutlet,
  _renderMatches,
} from "./hooks";

// Module-scoped singleton to hold the router.  Extracted from the React lifecycle
// to avoid issues w.r.t. dual initialization fetches in concurrent rendering.
// Data router apps are expected to have a static route tree and are not intended
// to be unmounted/remounted at runtime.
let routerSingleton: RemixRouter;

/**
 * Unit-testing-only function to reset the router between tests
 * @private
 */
export function _resetModuleScope() {
  // @ts-expect-error
  routerSingleton = null;
}

/**
 * A higher-order component that, given a Remix Router instance. setups the
 * Context's required for data routing
 */
export function DataRouterProvider({
  basename,
  children,
  fallbackElement,
  router,
}: {
  basename?: string;
  children?: React.ReactNode;
  fallbackElement?: React.ReactNode;
  router: RemixRouter;
}): React.ReactElement {
  // Sync router state to our component state to force re-renders
  let state: RouterState = useSyncExternalStoreShim(
    router.subscribe,
    () => router.state,
    // We have to provide this so React@18 doesn't complain during hydration,
    // but we pass our serialized hydration data into the router so state here
    // is already synced with what the server saw
    () => router.state
  );

  let navigator = React.useMemo((): Navigator => {
    return {
      createHref: router.createHref,
      go: (n) => router.navigate(n),
      push: (to, state, opts) =>
        router.navigate(to, { state, resetScroll: opts?.resetScroll }),
      replace: (to, state, opts) =>
        router.navigate(to, {
          replace: true,
          state,
          resetScroll: opts?.resetScroll,
        }),
    };
  }, [router]);

  let dataRouterContext: DataRouterContextObject = {
    router,
    navigator,
    static: false,
    basename: basename || "/",
  };

  if (!state.initialized) {
    return <>{fallbackElement}</>;
  }

  return (
    <DefaultDataRouterContext.Provider value={dataRouterContext}>
      <DefaultDataRouterStateContext.Provider
        value={state}
        children={children}
      />
    </DefaultDataRouterContext.Provider>
  );
}

/**
 * A data-aware wrapper for `<Router>` that leverages the Context's provided by
 * `<DataRouterProvider>`
 */
export function DataRouter() {
  let dataRouterContext = React.useContext(DefaultDataRouterContext);
  invariant(
    dataRouterContext,
    "<DataRouter> may only be rendered within a DataRouterContext"
  );
  let { router, navigator, basename } = dataRouterContext;

  return (
    <Router
      basename={basename}
      location={router.state.location}
      navigationType={router.state.historyAction}
      navigator={navigator}
    >
      <Routes />
    </Router>
  );
}

export interface DataMemoryRouterProps {
  basename?: string;
  children?: React.ReactNode;
  initialEntries?: InitialEntry[];
  initialIndex?: number;
  hydrationData?: HydrationState;
  fallbackElement?: React.ReactNode;
  routes?: RouteObject[];
}

export function DataMemoryRouter({
  basename,
  children,
  initialEntries,
  initialIndex,
  hydrationData,
  fallbackElement,
  routes,
}: DataMemoryRouterProps): React.ReactElement {
  if (!routerSingleton) {
    routerSingleton = createMemoryRouter({
      basename,
      hydrationData,
      initialEntries,
      initialIndex,
      routes: routes || createRoutesFromChildren(children),
    }).initialize();
  }
  let router = routerSingleton;

  return (
    <DataRouterProvider
      router={router}
      basename={basename}
      fallbackElement={fallbackElement}
    >
      <DataRouter />
    </DataRouterProvider>
  );
}

export function createNestableMemoryRouter() {
  const LocationContext = createLocationContext();
  const NavigationContext = createNavigationContext();
  const RouteContext = createRouteContext();
  const DataRouterStateContext = createDataRouterStateContext();
  const DataRouterContext = createDataRouterContext();

  const NestableMemoryRouter = createScopedMemoryRouter(
    LocationContext,
    NavigationContext,
    DataRouterStateContext,
    DataRouterContext,
    RouteContext
  );

  const NestableNavigate = createScopedNavigate(
    LocationContext,
    NavigationContext,
    RouteContext
  );

  return {
    NestableMemoryRouter,
    NestableNavigate,
    hooks: {
      useHref: createHrefHook(LocationContext, NavigationContext),
      useLocation: createLocationHook(LocationContext),
      useNavigationType: createNavigationTypeHook(LocationContext),
      useMatch: createMatchHook(LocationContext),
      useNavigate: createNavigateHook(LocationContext, NavigationContext),
      useParams: createParamsHook(RouteContext),
      useResolvedPath: createResolvedPathHook(LocationContext, RouteContext),
      useRoutes: createRoutesHook(
        LocationContext,
        RouteContext,
        DataRouterStateContext
      ),
      useOutlet: createOutletHook(RouteContext),
    },
  };
}

export interface MemoryRouterProps {
  basename?: string;
  children?: React.ReactNode;
  initialEntries?: InitialEntry[];
  initialIndex?: number;
}

function createScopedMemoryRouter(
  LocationContext = DefaultLocationContext,
  NavigationContext = DefaultNavigationContext,
  DataRouterStateContext = DefaultDataRouterStateContext,
  DataRouterContext = DefaultDataRouterContext,
  RouteContext = DefaultRouteContext
) {
  return function MemoryRouter({
    basename,
    children,
    initialEntries,
    initialIndex,
  }: MemoryRouterProps): React.ReactElement {
    let historyRef = React.useRef<MemoryHistory>();
    if (historyRef.current == null) {
      historyRef.current = createMemoryHistory({
        initialEntries,
        initialIndex,
        v5Compat: true,
      });
    }

    let history = historyRef.current;
    let [state, setState] = React.useState({
      action: history.action,
      location: history.location,
    });

    React.useLayoutEffect(() => history.listen(setState), [history]);

    return (
      <Router
        basename={basename}
        children={children}
        location={state.location}
        navigationType={state.action}
        navigator={history}
        LocationContext={LocationContext}
        NavigationContext={NavigationContext}
        DataRouterStateContext={DataRouterStateContext}
        DataRouterContext={DataRouterContext}
        RouteContext={RouteContext}
      />
    );
  };
}

/**
 * A <Router> that stores all entries in memory.
 *
 * @see https://reactrouter.com/docs/en/v6/routers/memory-router
 */
export const MemoryRouter = createScopedMemoryRouter();

export interface NavigateProps {
  to: To;
  replace?: boolean;
  state?: any;
}

function createScopedNavigate(
  LocationContext: typeof DefaultLocationContext = DefaultLocationContext,
  NavigationContext: typeof DefaultNavigationContext = DefaultNavigationContext,
  RouteContext: typeof DefaultRouteContext = DefaultRouteContext
) {
  const useScopedNavigate = createNavigateHook(
    LocationContext,
    NavigationContext,
    RouteContext
  );

  return function Navigate({ to, replace, state }: NavigateProps): null {
    invariant(
      useInRouterContext(),
      // TODO: This error is probably because they somehow have 2 versions of
      // the router loaded. We can help them understand how to avoid that.
      `<Navigate> may be used only in the context of a <Router> component.`
    );

    warning(
      !React.useContext(DefaultNavigationContext).static,
      `<Navigate> must not be used on the initial render in a <StaticRouter>. ` +
        `This is a no-op, but you should modify your code so the <Navigate> is ` +
        `only ever rendered in response to some user interaction or state change.`
    );

    let navigate = useScopedNavigate();
    React.useEffect(() => {
      navigate(to, { replace, state });
    });

    return null;
  };
}

/**
 * Changes the current location.
 *
 * Note: This API is mostly useful in React.Component subclasses that are not
 * able to use hooks. In functional components, we recommend you use the
 * `useNavigate` hook instead.
 *
 * @see https://reactrouter.com/docs/en/v6/components/navigate
 */
export const Navigate = createScopedNavigate();

export interface OutletProps {
  context?: unknown;
}

/**
 * Renders the child route's element, if there is one.
 *
 * @see https://reactrouter.com/docs/en/v6/components/outlet
 */
export function Outlet(props: OutletProps): React.ReactElement | null {
  return useOutlet(props.context);
}

interface DataRouteProps {
  id?: RouteObject["id"];
  loader?: RouteObject["loader"];
  action?: RouteObject["action"];
  errorElement?: RouteObject["errorElement"];
  shouldRevalidate?: RouteObject["shouldRevalidate"];
  handle?: RouteObject["handle"];
}

export interface RouteProps extends DataRouteProps {
  caseSensitive?: boolean;
  children?: React.ReactNode;
  element?: React.ReactNode | null;
  index?: boolean;
  path?: string;
}

export interface PathRouteProps extends DataRouteProps {
  caseSensitive?: boolean;
  children?: React.ReactNode;
  element?: React.ReactNode | null;
  index?: false;
  path: string;
}

export interface LayoutRouteProps extends DataRouteProps {
  children?: React.ReactNode;
  element?: React.ReactNode | null;
}

export interface IndexRouteProps extends DataRouteProps {
  element?: React.ReactNode | null;
  index: true;
}

/**
 * Declares an element that should be rendered at a certain URL path.
 *
 * @see https://reactrouter.com/docs/en/v6/components/route
 */
export function Route(
  _props: PathRouteProps | LayoutRouteProps | IndexRouteProps
): React.ReactElement | null {
  invariant(
    false,
    `A <Route> is only ever to be used as the child of <Routes> element, ` +
      `never rendered directly. Please wrap your <Route> in a <Routes>.`
  );
}

export interface RouterProps {
  basename?: string;
  children?: React.ReactNode;
  location: Partial<Location> | string;
  navigationType?: NavigationType;
  navigator: Navigator;
  static?: boolean;
  NavigationContext?: typeof DefaultNavigationContext;
  LocationContext?: typeof DefaultLocationContext;
  DataRouterStateContext?: typeof DefaultDataRouterStateContext;
  DataRouterContext?: typeof DefaultDataRouterContext;
  RouteContext?: typeof DefaultRouteContext;
}

/**
 * Provides location context for the rest of the app.
 *
 * Note: You usually won't render a <Router> directly. Instead, you'll render a
 * router that is more specific to your environment such as a <BrowserRouter>
 * in web browsers or a <StaticRouter> for server rendering.
 *
 * @see https://reactrouter.com/docs/en/v6/routers/router
 */
export function Router({
  basename: basenameProp = "/",
  children = null,
  location: locationProp,
  navigationType = NavigationType.Pop,
  navigator,
  static: staticProp = false,
  NavigationContext = DefaultNavigationContext,
  LocationContext = DefaultLocationContext,
  DataRouterStateContext = DefaultDataRouterStateContext,
  DataRouterContext = DefaultDataRouterContext,
  RouteContext = DefaultRouteContext,
}: RouterProps): React.ReactElement | null {
  invariant(
    LocationContext !== React.useContext(RouterContext)?.LocationContext,
    `You cannot render a <Router> inside another <Router>.` +
      ` You should never have more than one in your app.`
  );

  const routerContext = React.useMemo(
    () => ({
      LocationContext,
      NavigationContext,
      DataRouterStateContext,
      DataRouterContext,
      RouteContext,
      useRoutes: createRoutesHook(
        LocationContext,
        RouteContext,
        DataRouterStateContext
      ),
      useNavigate: createNavigateHook(
        LocationContext,
        NavigationContext,
        RouteContext
      ),
    }),
    [
      LocationContext,
      NavigationContext,
      DataRouterStateContext,
      DataRouterContext,
      RouteContext,
    ]
  );

  // Preserve trailing slashes on basename, so we can let the user control
  // the enforcement of trailing slashes throughout the app
  let basename = basenameProp.replace(/^\/*/, "/");
  let navigationContext = React.useMemo(
    () => ({ basename, navigator, static: staticProp }),
    [basename, navigator, staticProp]
  );

  if (typeof locationProp === "string") {
    locationProp = parsePath(locationProp);
  }

  let {
    pathname = "/",
    search = "",
    hash = "",
    state = null,
    key = "default",
  } = locationProp;

  let location = React.useMemo(() => {
    let trailingPathname = stripBasename(pathname, basename);

    if (trailingPathname == null) {
      return null;
    }

    return {
      pathname: trailingPathname,
      search,
      hash,
      state,
      key,
    };
  }, [basename, pathname, search, hash, state, key]);

  warning(
    location != null,
    `<Router basename="${basename}"> is not able to match the URL ` +
      `"${pathname}${search}${hash}" because it does not start with the ` +
      `basename, so the <Router> won't render anything.`
  );

  if (location == null) {
    return null;
  }

  return (
    <RouterContext.Provider value={routerContext}>
      <NavigationContext.Provider value={navigationContext}>
        <LocationContext.Provider
          children={children}
          value={{ location, navigationType }}
        />
      </NavigationContext.Provider>
    </RouterContext.Provider>
  );
}

export interface RoutesProps {
  children?: React.ReactNode;
  location?: Partial<Location> | string;
}

/**
 * A container for a nested tree of <Route> elements that renders the branch
 * that best matches the current location.
 *
 * @see https://reactrouter.com/docs/en/v6/components/routes
 */
export function Routes({
  children,
  location,
}: RoutesProps): React.ReactElement | null {
  const { DataRouterContext, useRoutes } = React.useContext(RouterContext);

  let dataRouterContext = React.useContext(DataRouterContext);
  // When in a DataRouterContext _without_ children, we use the router routes
  // directly.  If we have children, then we're in a descendant tree and we
  // need to use child routes.
  let routes =
    dataRouterContext && !children
      ? dataRouterContext.router.routes
      : createRoutesFromChildren(children);
  return useRoutes(routes, location);
}

export interface DeferredResolveRenderFunction {
  (data: Awaited<any>): JSX.Element;
}

export interface DeferredProps {
  children: React.ReactNode | DeferredResolveRenderFunction;
  value: any;
  errorElement?: React.ReactNode;
}

/**
 * Component to use for rendering lazily loaded data from returning deferred()
 * in a loader function
 */
export function Deferred({ children, value, errorElement }: DeferredProps) {
  return (
    <DeferredErrorBoundary value={value} errorElement={errorElement}>
      <ResolveDeferred>{children}</ResolveDeferred>
    </DeferredErrorBoundary>
  );
}

type DeferredErrorBoundaryProps = React.PropsWithChildren<{
  value: any;
  errorElement?: React.ReactNode;
}>;

type DeferredErrorBoundaryState = {
  error: any;
};

class DeferredErrorBoundary extends React.Component<
  DeferredErrorBoundaryProps,
  DeferredErrorBoundaryState
> {
  constructor(props: DeferredErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error(
      "<Deferred> caught the following error during render",
      error,
      errorInfo
    );
  }

  render() {
    let { children, errorElement, value } = this.props;

    // Handle render errors from this.state, or data errors from context
    let error = this.state.error || (isDeferredError(value) ? value : null);

    if (error) {
      if (errorElement) {
        // We have our own errorElement, provide our error and render it
        return (
          <DeferredContext.Provider value={error} children={errorElement} />
        );
      }
      // Throw to the nearest ancestor route-level error boundary
      throw error;
    }

    if (value instanceof Promise) {
      // Throw to the suspense boundary
      throw value;
    }

    // We've resolved successfully, provide the value and render the children
    return <DeferredContext.Provider value={value} children={children} />;
  }
}

/**
 * @private
 * Indirection to leverage useDeferredData for a render-prop API on <Deferred>
 */
function ResolveDeferred({
  children,
}: {
  children: React.ReactNode | DeferredResolveRenderFunction;
}) {
  let data = useDeferredData();
  if (typeof children === "function") {
    return children(data);
  }
  return <>{children}</>;
}

///////////////////////////////////////////////////////////////////////////////
// UTILS
///////////////////////////////////////////////////////////////////////////////

/**
 * Creates a route config from a React "children" object, which is usually
 * either a `<Route>` element or an array of them. Used internally by
 * `<Routes>` to create a route config from its children.
 *
 * @see https://reactrouter.com/docs/en/v6/utils/create-routes-from-children
 */
export function createRoutesFromChildren(
  children: React.ReactNode,
  parentPath: number[] = []
): RouteObject[] {
  let routes: RouteObject[] = [];

  React.Children.forEach(children, (element, index) => {
    if (!React.isValidElement(element)) {
      // Ignore non-elements. This allows people to more easily inline
      // conditionals in their route config.
      return;
    }

    if (element.type === React.Fragment) {
      // Transparently support React.Fragment and its children.
      routes.push.apply(
        routes,
        createRoutesFromChildren(element.props.children, parentPath)
      );
      return;
    }

    invariant(
      element.type === Route,
      `[${
        typeof element.type === "string" ? element.type : element.type.name
      }] is not a <Route> component. All component children of <Routes> must be a <Route> or <React.Fragment>`
    );

    let treePath = [...parentPath, index];
    let route: RouteObject = {
      id: element.props.id || treePath.join("-"),
      caseSensitive: element.props.caseSensitive,
      element: element.props.element,
      index: element.props.index,
      path: element.props.path,
      loader: element.props.loader,
      action: element.props.action,
      errorElement: element.props.errorElement,
      shouldRevalidate: element.props.shouldRevalidate,
      handle: element.props.handle,
    };

    if (element.props.children) {
      route.children = createRoutesFromChildren(
        element.props.children,
        treePath
      );
    }

    routes.push(route);
  });

  return routes;
}

/**
 * Renders the result of `matchRoutes()` into a React element.
 */
export function renderMatches(
  matches: RouteMatch[] | null
): React.ReactElement | null {
  return _renderMatches(matches);
}
