import { Link, useLocation } from "wouter";
import { LayoutDashboard, Map as MapIcon, Wrench, Users, Satellite, FileBarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();

  const links = [
    { href: "/",         label: "Dashboard",      icon: LayoutDashboard },
    { href: "/soporte",  label: "Soporte Técnico", icon: Wrench          },
    { href: "/clientes", label: "Clientes",        icon: Users           },
    { href: "/mapa",     label: "Mapa en Vivo",    icon: MapIcon         },
    { href: "/reportes", label: "Reportes",         icon: FileBarChart2   },
  ];

  return (
    <div
      className="w-64 h-full flex flex-col flex-shrink-0 relative overflow-hidden"
      style={{ background: "linear-gradient(180deg, #0A1A3E 0%, #0D2255 60%, #0A1A3E 100%)" }}
    >
      {/* Decorative glow top-right */}
      <div
        className="absolute top-0 right-0 w-40 h-40 rounded-full pointer-events-none opacity-20"
        style={{ background: "radial-gradient(circle, #1E6FBF 0%, transparent 70%)", transform: "translate(30%, -30%)" }}
      />
      {/* Decorative glow bottom-left */}
      <div
        className="absolute bottom-0 left-0 w-32 h-32 rounded-full pointer-events-none opacity-15"
        style={{ background: "radial-gradient(circle, #5B9B2A 0%, transparent 70%)", transform: "translate(-30%, 30%)" }}
      />

      {/* Brand */}
      <div className="relative px-5 pt-6 pb-5 border-b" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <img
              src="/logo-gps.png"
              alt="GPS SISTEMA C.A."
              className="w-20 h-20 object-contain drop-shadow-lg"
            />
          </div>
          <div className="text-center">
            <h1 className="text-sm font-black text-white leading-tight tracking-wide">GPS SISTEMA C.A.</h1>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] mt-0.5" style={{ color: "#E8720C" }}>
              Panel de Control
            </p>
          </div>
        </div>
        {/* Brand accent line */}
        <div className="mt-4 h-px w-full brand-gradient rounded-full opacity-60" />
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto relative z-10">
        <p className="text-[10px] font-bold uppercase tracking-[0.25em] px-3 pb-2 opacity-40 text-white">
          Navegación
        </p>
        {links.map((link) => {
          const isActive = location === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 relative group",
                isActive
                  ? "text-white"
                  : "text-white/55 hover:text-white/90 hover:bg-white/5"
              )}
              style={isActive ? {
                background: "linear-gradient(90deg, rgba(232,114,12,0.18) 0%, rgba(30,111,191,0.12) 100%)",
              } : {}}
            >
              {/* Active left accent */}
              {isActive && (
                <div
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full"
                  style={{ background: "linear-gradient(180deg, #E8720C, #F5A623)" }}
                />
              )}
              <Icon
                className="w-4 h-4 flex-shrink-0 transition-colors"
                style={{ color: isActive ? "#E8720C" : undefined }}
              />
              {link.label}
              {isActive && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: "#E8720C" }} />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="relative z-10 px-4 py-4 border-t" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
        <div className="flex items-center gap-2 justify-center">
          <Satellite className="w-3 h-3 opacity-30 text-white" />
          <span className="text-[10px] text-white/30 font-semibold uppercase tracking-widest">
            GPS Admin v1.0
          </span>
        </div>
      </div>
    </div>
  );
}
