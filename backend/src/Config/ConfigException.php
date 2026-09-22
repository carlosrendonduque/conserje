<?php

declare(strict_types=1);

namespace Conserje\Config;

/** Raised when a site config is missing, unreadable, or structurally invalid. */
final class ConfigException extends \RuntimeException
{
}
