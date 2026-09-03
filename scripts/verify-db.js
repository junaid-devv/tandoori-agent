const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function verify() {
  console.log('🔍 Checking active branches...');
  const { data: branches } = await supabase.from('branches').select('*');
  console.log('Branches:', branches);

  const { data: settings } = await supabase.from('restaurant_settings').select('*');
  console.log('Settings:', settings);

  const { data: items } = await supabase
    .from('menu_items')
    .select('id, name, price, category, description, is_available')
    .eq('is_available', true)
    .order('category');

  const grouped = {};
  for (const item of (items || [])) {
    grouped[item.category] = grouped[item.category] || [];
    grouped[item.category].push({ name: item.name, price: item.price, desc: item.description });
  }

  console.log('\n--- Active Menu Items by Category ---');
  for (const [cat, list] of Object.entries(grouped)) {
    console.log(`\n=== Category: ${cat} (${list.length} items) ===`);
    list.forEach(i => console.log(`  - ${i.name} (Rs. ${i.price})${i.desc ? ' | ' + i.desc : ''}`));
  }
}

verify().catch(console.error);

