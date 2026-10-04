-- Inside the CRM, use the "CRM skin" address of the local Activepieces (logo and extra menus hidden)
update public.integration_config set value = 'http://localhost:8081' where key = 'builder_url' and value = 'http://localhost:8080';
