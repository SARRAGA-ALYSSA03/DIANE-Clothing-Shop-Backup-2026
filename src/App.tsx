import { useEffect, useState } from "react";
import { ArrowRight, Bike, LockKeyhole, ShoppingBag, Store } from "lucide-react";
import { AdminApp } from "./apps/AdminApp";
import { CustomerApp } from "./apps/CustomerApp";
import { RiderApp } from "./apps/RiderApp";
import { AuthPanel, ResetPasswordPanel } from "./components/common/AuthPanel";
import { Brand } from "./components/common/Brand";
import { LoadingState } from "./components/common/StateView";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import type { Role } from "./types/commerce";

type Portal = Role | null;

const portalFromHash = (): Portal => {
  const value = window.location.hash.replace(/^#\/?/, "");
  if (value === "customer" || value === "rider" || value === "admin") return value;
  try {
    const saved = window.localStorage.getItem("diane-last-portal-role");
    if (saved === "customer" || saved === "rider" || saved === "admin") return saved;
  } catch { /* Storage may be unavailable in some WebViews. */ }
  return null;
};

function DianeEcosystem() {
  const { loading, passwordRecovery, user, profile, signOut } = useAuth();
  const [portal, setPortal] = useState<Portal>(portalFromHash);
  const [authRole, setAuthRole] = useState<Role | null>(null);

  const navigate = (next: Portal) => {
    window.location.hash = next ? `/${next}` : "/";
    setPortal(next);
    try {
      if (next) window.localStorage.setItem("diane-last-portal-role", next);
      else window.localStorage.removeItem("diane-last-portal-role");
    } catch { /* Navigation must still work if storage is unavailable. */ }
    if (!next) setAuthRole(null);
  };

  // All protected portals use this same logout path:
  // sign out, clear the remembered portal, and return to the chooser.
  const handleLogout = async () => {
    await signOut();
    try {
      window.localStorage.removeItem("diane-last-portal-role");
    } catch {
      // Portal navigation should still complete when browser storage is unavailable.
    }
    navigate(null);
  };

  useEffect(() => {
    const syncRoute = () => setPortal(portalFromHash());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);


    // Keep the password recovery screen mounted during auth updates.
    if (passwordRecovery) return <ResetPasswordPanel />;

    if (loading) {
      return (
        <div className="app-loading">
          <Brand />
          <LoadingState />
        </div>
      );
    }


  if (authRole) {
    if (!user) {
      return <AuthPanel role={authRole} onBack={() => setAuthRole(null)} />;
    }
    if (
      authRole !== "customer" &&
      (profile?.role !== authRole || (authRole === "rider" && profile?.active === false))
    ) {
      return (
        <main className="access-denied">
          <LockKeyhole size={34} />
          <span className="eyebrow">ROLE VERIFICATION</span>
          <h1>{authRole === "rider" && profile?.active === false ? "This rider account is inactive." : `This account cannot access the ${authRole} portal.`}</h1>
          <p>
            {authRole === "rider" && profile?.active === false
              ? "Contact the DIANE administrator to reactivate your rider account."
              : "DIANE checks your role against the existing Supabase profile before opening protected operations."}
          </p>
          <button
            className="button button--dark"
            onClick={() => void handleLogout()}
          >
            SIGN OUT AND RETURN
          </button>
        </main>
      );
    }
  }

  const activePortal = portal ?? (user ? authRole : null);

  if (
    activePortal &&
    (!user || profile?.role !== activePortal || (activePortal === "rider" && profile?.active === false))
  ) {
    if (!user) {
      return <AuthPanel role={activePortal} onBack={() => navigate(null)} />;
    }
    return (
      <main className="access-denied">
        <LockKeyhole size={34} />
        <span className="eyebrow">ROLE VERIFICATION</span>
        <h1>{activePortal === "rider" && profile?.active === false ? "This rider account is inactive." : `This account cannot access the ${activePortal} portal.`}</h1>
        <p>
          {activePortal === "rider" && profile?.active === false
            ? "Contact the DIANE administrator to reactivate your rider account."
            : "DIANE checks your role against the existing Supabase profile before opening protected operations."}
        </p>
        <button
          className="button button--dark"
          onClick={() => void handleLogout()}
        >
          SIGN OUT AND RETURN
        </button>
      </main>
    );
  }

  if (activePortal === "customer") {
    return (
      <CustomerApp onSignIn={() => setAuthRole("customer")} onLogout={handleLogout} />
    );
  }
  if (activePortal === "rider") {
    return <RiderApp onLogout={handleLogout} />;
  }
  if (activePortal === "admin") {
    return <AdminApp onLogout={handleLogout} />;
  }

  return (
    <main className="portal-home">
      <section className="portal-visual">
        <img src="/diane/top5.png" alt="" />
        <div className="portal-visual__shade" />
        <div className="portal-visual__brand">
          <Brand light />
        </div>
        <div className="portal-visual__copy">
          <span className="eyebrow">ONE CONNECTED ECOSYSTEM</span>
          <h1>
            Style, service,
            <br />
            in perfect sync.
          </h1>
          <p>DIANE brings shopping, delivery, and store operations together.</p>
        </div>
      </section>
      <section className="portal-chooser">
        <header>
          <Brand />
          <span>SELECT EXPERIENCE</span>
        </header>
        <div className="portal-intro">
          <span className="eyebrow">WELCOME TO DIANE</span>
          <h2>Where would you like to go?</h2>
          <p>
            Choose your secure DIANE experience. Every portal shares the same products, orders, and
            accounts.
          </p>
        </div>
        <div className="portal-options">
          {(!user || profile?.role === "customer") && <button onClick={() => navigate("customer")}>
            <span><ShoppingBag size={22} /></span>
            <div><strong>Shop DIANE</strong><small>Discover collections, orders, and live try-on</small></div>
            <ArrowRight size={20} />
          </button>}
          {(!user || profile?.role === "rider") && <button onClick={() => navigate("rider")}>
            <span><Bike size={22} /></span>
            <div><strong>Rider portal</strong><small>Manage assigned deliveries on the move</small></div>
            <ArrowRight size={20} />
          </button>}
          {(!user || profile?.role === "admin") && <button onClick={() => navigate("admin")}>
            <span><Store size={22} /></span>
            <div><strong>Admin dashboard</strong><small>Operate the DIANE store and delivery network</small></div>
            <ArrowRight size={20} />
          </button>}
        </div>
        <footer>
          <LockKeyhole size={14} /> Secured by Supabase Authentication and Row Level Security
        </footer>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <DianeEcosystem />
    </AuthProvider>
  );
}
