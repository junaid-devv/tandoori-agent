const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const email = 'demo_admin@tandoori.pk';
  const password = 'DemoAdmin123!';
  const fullName = 'Demo Admin';

  const { data: usersData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;

  const existingUser = usersData.users.find(u => u.email === email);
  let userId;

  if (existingUser) {
    userId = existingUser.id;
    console.log("Updating password for existing demo admin:", userId);
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password
    });
    if (updateError) throw updateError;
  } else {
    console.log("Creating new demo admin");
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });
    if (createError) throw createError;
    userId = created.user.id;
  }

  // Ensure staff profile exists
  const { error: profileError } = await supabaseAdmin.from("staff_profiles").upsert(
    {
      user_id: userId,
      full_name: fullName,
      role: 'admin',
      default_branch_id: null,
    },
    { onConflict: "user_id" }
  );
  if (profileError) throw profileError;

  console.log("Demo user setup complete for:", email);
}

main().catch(console.error);
