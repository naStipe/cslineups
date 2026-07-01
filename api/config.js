module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.status(200).json({
    supabaseUrl:     process.env.SUPABASE_URL     || "",
    supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpqb2JjdnR1dmRkeml2eXVydHNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NTExODAsImV4cCI6MjA5ODQyNzE4MH0.Cl2T-_4VFbTbUZBbyYOPobNwTaUJ6LSBctpG8vF234s",
  });
};
