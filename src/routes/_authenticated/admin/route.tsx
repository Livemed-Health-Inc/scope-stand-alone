import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout;
});

function AdminLayout() {
  return null;
}
