-- Where a member's city actually is.
--
-- Resolved by the server when the member changes their city and stored with
-- the profile, so drawing the network map needs no geocoder at read time.
-- These are never written from a request body: a client able to set them could
-- drop its pin on any address it liked, and the map promises city precision.

alter table public.profiles
  add column if not exists city_lat double precision,
  add column if not exists city_lon double precision,
  add column if not exists city_label text not null default '';

comment on column public.profiles.city_lat is
  'Latitude of the member city, resolved server-side. Never client-supplied.';
comment on column public.profiles.city_lon is
  'Longitude of the member city, resolved server-side. Never client-supplied.';
comment on column public.profiles.city_label is
  'The geocoder''s canonical name for the city, shown so a member can confirm the pin.';

-- Only rows already visible under the existing profile policies are affected;
-- no policy changes are needed, and no index either: the map reads whole rows
-- for the directory, which is already bounded by the consent filter.
